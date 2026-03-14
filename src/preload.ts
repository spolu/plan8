import { contextBridge, ipcRenderer } from "electron";
import type {
  Plan8API,
  ContainerRunOpts,
  ContainerStopOpts,
  ContainerExecOpts,
} from "./plan8-api";

const api: Plan8API = {
  setup: {
    check: () => ipcRenderer.invoke("setup:check"),
    openReleases: () => ipcRenderer.invoke("setup:open-releases"),
  },
  container: {
    list: () => ipcRenderer.invoke("container:list"),
    run: (opts: ContainerRunOpts) => ipcRenderer.invoke("container:run", opts),
    stop: (opts: ContainerStopOpts) =>
      ipcRenderer.invoke("container:stop", opts),
    exec: (opts: ContainerExecOpts) =>
      ipcRenderer.invoke("container:exec", opts),
  },
};

contextBridge.exposeInMainWorld("plan8", api);
