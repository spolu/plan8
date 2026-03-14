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
  shell: {
    send: (name: string, command: string) =>
      ipcRenderer.send("shell:send", name, command),
  },
};

contextBridge.exposeInMainWorld("plan8", api);
