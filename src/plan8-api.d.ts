/** Shared type definitions for the plan8 API exposed via contextBridge. */

export interface SetupCheckResult {
  status: "not-installed" | "not-running" | "ready";
  version?: string | null;
}

export interface ContainerRunOpts {
  image: string;
  name: string;
  volume?: string;
}

export interface ContainerStopOpts {
  name: string;
}

export interface ContainerListEntry {
  name?: string;
  Name?: string;
  image?: string;
  Image?: string;
  [key: string]: unknown;
}

export interface Plan8API {
  setup: {
    check: () => Promise<SetupCheckResult>;
    openReleases: () => Promise<void>;
  };
  container: {
    list: () => Promise<ContainerListEntry[]>;
    run: (opts: ContainerRunOpts) => Promise<string>;
    stop: (opts: ContainerStopOpts) => Promise<string>;
    onOutput: (callback: (name: string, line: string) => void) => void;
  };
  shell: {
    send: (name: string, command: string) => void;
  };
}

declare global {
  interface Window {
    plan8: Plan8API;
  }
}
