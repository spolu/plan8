import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import { execFile, spawn } from "child_process";
import { updateElectronApp } from "update-electron-app";
import * as pty from "node-pty";
import type {
  SetupCheckResult,
  AgentProfile,
  ContainerRunOpts,
  ContainerStopOpts,
  ContainerListEntry,
} from "./plan8-api";
import {
  ensureDefaults,
  listAgents,
  getAgent,
  saveAgent,
  deleteAgent,
  AGENTS_DIR,
} from "./agents";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
}

if (app.isPackaged) {
  updateElectronApp();
}

app.whenReady().then(() => {
  ensureDefaults();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

// --- Setup detection ---

function checkContainerInstalled(): Promise<{
  installed: boolean;
  version: string | null;
}> {
  return new Promise((resolve) => {
    execFile("/usr/local/bin/container", ["--version"], (err, stdout) => {
      if (err) return resolve({ installed: false, version: null });
      resolve({ installed: true, version: stdout.trim() });
    });
  });
}

function checkContainerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "/usr/local/bin/container",
      ["system", "status"],
      (err, _stdout) => {
        if (err) return resolve(false);
        resolve(true);
      }
    );
  });
}

ipcMain.handle("setup:check", async (): Promise<SetupCheckResult> => {
  const { installed, version } = await checkContainerInstalled();
  if (!installed) {
    return { status: "not-installed" };
  }
  const running = await checkContainerRunning();
  if (!running) {
    return { status: "not-running", version };
  }
  return { status: "ready", version };
});

ipcMain.handle("setup:open-releases", async (): Promise<void> => {
  shell.openExternal("https://github.com/apple/container/releases/latest");
});

// --- Agent profiles ---

ipcMain.handle(
  "agents:list",
  async (): Promise<AgentProfile[]> => listAgents()
);

ipcMain.handle(
  "agents:get",
  async (_event, id: string): Promise<AgentProfile> => getAgent(id)
);

ipcMain.handle(
  "agents:save",
  async (_event, agent: AgentProfile): Promise<void> => saveAgent(agent)
);

ipcMain.handle(
  "agents:delete",
  async (_event, id: string): Promise<void> => deleteAgent(id)
);

// --- Container management via apple/container CLI ---

const CONTAINER = "/usr/local/bin/container";

ipcMain.handle(
  "container:list",
  async (): Promise<ContainerListEntry[]> => {
    return new Promise((resolve) => {
      execFile(CONTAINER, ["ls", "--format", "json"], (err, stdout) => {
        if (err) return resolve([]);
        try {
          resolve(JSON.parse(stdout) as ContainerListEntry[]);
        } catch {
          resolve([]);
        }
      });
    });
  }
);

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function containerCmd(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(CONTAINER, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

async function removeIfExists(name: string): Promise<void> {
  try {
    await containerCmd(["stop", name]);
  } catch {
    // not running
  }
  try {
    await containerCmd(["rm", name]);
  } catch {
    // doesn't exist
  }
}

function spawnStreaming(
  name: string,
  command: string,
  args: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let output = "";
    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) sendToRenderer("container:output", name, trimmed);
      }
    });
    proc.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) sendToRenderer("container:output", name, trimmed);
      }
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(output || `exited with code ${code}`));
      }
      resolve(output.trim());
    });
    proc.on("error", (err) => reject(err));
  });
}

ipcMain.handle(
  "container:run",
  async (
    _event,
    { name, agentId, volume }: ContainerRunOpts
  ): Promise<string> => {
    const imageName = `plan8-${agentId}`;
    const dockerfileDir = path.join(AGENTS_DIR, agentId);

    // Stage credentials into build context
    const staged: string[] = [];

    function stageFile(src: string, dest: string, fallback: string): void {
      const target = path.join(dockerfileDir, dest);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, target);
      } else {
        fs.writeFileSync(target, fallback);
      }
      staged.push(target);
    }

    function stageDir(src: string, dest: string): void {
      const target = path.join(dockerfileDir, dest);
      if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
        fs.cpSync(src, target, { recursive: true });
      } else {
        fs.mkdirSync(target, { recursive: true });
      }
      staged.push(target);
    }

    const home = os.homedir();
    stageFile(path.join(home, ".pi", "agent", "auth.json"), "auth.json", "{}");
    stageFile(path.join(home, ".gitconfig"), ".gitconfig", "");
    stageDir(path.join(home, ".ssh"), ".ssh");
    stageFile(
      path.join(home, ".config", "gh", "hosts.yml"),
      "gh_hosts.yml",
      ""
    );

    // Build agent image from Dockerfile
    sendToRenderer("container:output", name, "building agent image...");
    try {
      await spawnStreaming(name, CONTAINER, [
        "build",
        "--build-arg", `AGENT_NAME=${agentId}`,
        "-t",
        imageName,
        dockerfileDir,
      ]);
    } finally {
      // Clean up all staged credentials from build context
      for (const s of staged) {
        try {
          fs.rmSync(s, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    // Remove old container if exists
    await removeIfExists(name);

    // Run container with built image
    sendToRenderer("container:output", name, "starting container...");
    const args = [
      "run", "-d", "--init", "--name", name,
      "--label", "plan8=true",
      "--label", `plan8.agent=${agentId}`,
    ];
    if (volume) args.push("--volume", volume);
    args.push(imageName, "sleep", "infinity");
    return spawnStreaming(name, CONTAINER, args);
  }
);

ipcMain.handle(
  "container:stop",
  async (_event, { name }: ContainerStopOpts): Promise<string> => {
    destroyPty(name);
    return new Promise((resolve, reject) => {
      execFile(CONTAINER, ["stop", name], (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      });
    });
  }
);

// --- PTY sessions ---

const ptys = new Map<string, pty.IPty>();

ipcMain.handle(
  "pty:spawn",
  async (
    _event,
    name: string,
    command: string,
    args: string[],
    cols: number,
    rows: number
  ): Promise<void> => {
    destroyPty(name);

    const p = pty.spawn(command, args, {
      name: "xterm-256color",
      cols,
      rows,
      env: process.env,
    });

    p.onData((data: string) => {
      sendToRenderer("pty:data", name, data);
    });

    p.onExit(({ exitCode }) => {
      ptys.delete(name);
      sendToRenderer("pty:exit", name, exitCode);
    });

    ptys.set(name, p);
  }
);

ipcMain.on("pty:write", (_event, name: string, data: string) => {
  const p = ptys.get(name);
  if (p) p.write(data);
});

ipcMain.on("pty:resize", (_event, name: string, cols: number, rows: number) => {
  const p = ptys.get(name);
  if (p) p.resize(cols, rows);
});

function destroyPty(name: string): void {
  const p = ptys.get(name);
  if (p) {
    p.kill();
    ptys.delete(name);
  }
}
