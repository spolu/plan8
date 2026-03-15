/** Shared type definitions for the plan8 API exposed via contextBridge. */

export interface SetupCheckResult {
  status: "not-installed" | "not-running" | "ready";
  version?: string | null;
}

export interface Profile {
  id: string;
  description: string;
  prompt: string;
  dockerfile: string;
}

export interface ContainerRunOpts {
  image: string;
  name: string;
  profileId: string;
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
  profiles: {
    list: () => Promise<Profile[]>;
    get: (id: string) => Promise<Profile>;
    save: (profile: Profile) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  container: {
    list: () => Promise<ContainerListEntry[]>;
    run: (opts: ContainerRunOpts) => Promise<string>;
    stop: (opts: ContainerStopOpts) => Promise<string>;
    onOutput: (callback: (name: string, line: string) => void) => void;
  };
  pty: {
    spawn: (
      name: string,
      command: string,
      args: string[],
      cols: number,
      rows: number
    ) => Promise<void>;
    write: (name: string, data: string) => void;
    resize: (name: string, cols: number, rows: number) => void;
    onData: (callback: (name: string, data: string) => void) => void;
    onExit: (callback: (name: string, exitCode: number) => void) => void;
  };
}

declare global {
  interface Window {
    plan8: Plan8API;
  }
}
