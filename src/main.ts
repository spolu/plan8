import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import { execFile } from "child_process";
import type {
  SetupCheckResult,
  ContainerRunOpts,
  ContainerStopOpts,
  ContainerExecOpts,
  ContainerExecResult,
  ContainerListEntry,
} from "./plan8-api";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
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

app.whenReady().then(createWindow);

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

ipcMain.handle(
  "container:run",
  async (
    _event,
    { image, name, volume }: ContainerRunOpts
  ): Promise<string> => {
    const args = ["run", "--name", name];
    if (volume) args.push("--volume", volume);
    args.push(image);
    return new Promise((resolve, reject) => {
      execFile(CONTAINER, args, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      });
    });
  }
);

ipcMain.handle(
  "container:stop",
  async (_event, { name }: ContainerStopOpts): Promise<string> => {
    return new Promise((resolve, reject) => {
      execFile(CONTAINER, ["stop", name], (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      });
    });
  }
);

ipcMain.handle(
  "container:exec",
  async (
    _event,
    { name, command }: ContainerExecOpts
  ): Promise<ContainerExecResult> => {
    return new Promise((resolve, reject) => {
      execFile(
        CONTAINER,
        ["exec", name, ...command],
        (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve({ stdout, stderr });
        }
      );
    });
  }
);
