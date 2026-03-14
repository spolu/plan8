import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { execFile, spawn } from "child_process";
import { updateElectronApp } from "update-electron-app";
import type { ChildProcess } from "child_process";
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

ipcMain.handle(
  "container:run",
  async (
    _event,
    { image, name, volume }: ContainerRunOpts
  ): Promise<string> => {
    await removeIfExists(name);
    const args = ["run", "-d", "--init", "--name", name];
    if (volume) args.push("--volume", volume);
    args.push(image, "sleep", "infinity");
    return new Promise((resolve, reject) => {
      const proc = spawn(CONTAINER, args);
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
);

ipcMain.handle(
  "container:stop",
  async (_event, { name }: ContainerStopOpts): Promise<string> => {
    destroyShell(name);
    return new Promise((resolve, reject) => {
      execFile(CONTAINER, ["stop", name], (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      });
    });
  }
);

// --- Persistent shell sessions ---

const shells = new Map<string, ChildProcess>();

function getOrCreateShell(name: string): ChildProcess {
  let proc = shells.get(name);
  if (proc && proc.exitCode === null) return proc;

  proc = spawn(CONTAINER, ["exec", "-i", name, "/bin/bash", "-l"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const MARKER = `__plan8_done_${Date.now()}__`;

  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === MARKER) continue;
      sendToRenderer("container:output", name, trimmed);
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) sendToRenderer("container:output", name, trimmed);
    }
  });

  proc.on("close", () => {
    shells.delete(name);
  });

  shells.set(name, proc);
  proc.stdin?.write('export PS1=""\n');

  return proc;
}

function destroyShell(name: string): void {
  const proc = shells.get(name);
  if (proc) {
    proc.kill();
    shells.delete(name);
  }
}

ipcMain.on("shell:send", (_event, name: string, command: string) => {
  const proc = getOrCreateShell(name);
  if (proc.stdin?.writable) {
    proc.stdin.write(command + "\n");
  }
});
