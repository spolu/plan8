import { contextBridge, ipcRenderer } from "electron";
import type {
  Plan8API,
  AgentProfile,
  ContainerRunOpts,
  ContainerStopOpts,
} from "./plan8-api";

const api: Plan8API = {
  setup: {
    check: () => ipcRenderer.invoke("setup:check"),
    openReleases: () => ipcRenderer.invoke("setup:open-releases"),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    get: (id: string) => ipcRenderer.invoke("agents:get", id),
    save: (agent: AgentProfile) => ipcRenderer.invoke("agents:save", agent),
    delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
  },
  container: {
    list: () => ipcRenderer.invoke("container:list"),
    run: (opts: ContainerRunOpts) => ipcRenderer.invoke("container:run", opts),
    stop: (opts: ContainerStopOpts) =>
      ipcRenderer.invoke("container:stop", opts),
    onOutput: (callback: (name: string, line: string) => void) => {
      ipcRenderer.on(
        "container:output",
        (_event, name: string, line: string) => callback(name, line)
      );
    },
  },
  pty: {
    spawn: (
      name: string,
      command: string,
      args: string[],
      cols: number,
      rows: number
    ) => ipcRenderer.invoke("pty:spawn", name, command, args, cols, rows),
    write: (name: string, data: string) =>
      ipcRenderer.send("pty:write", name, data),
    resize: (name: string, cols: number, rows: number) =>
      ipcRenderer.send("pty:resize", name, cols, rows),
    onData: (callback: (name: string, data: string) => void) => {
      ipcRenderer.on("pty:data", (_event, name: string, data: string) =>
        callback(name, data)
      );
    },
    onExit: (callback: (name: string, exitCode: number) => void) => {
      ipcRenderer.on("pty:exit", (_event, name: string, exitCode: number) =>
        callback(name, exitCode)
      );
    },
  },
};

contextBridge.exposeInMainWorld("plan8", api);
