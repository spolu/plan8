/// <reference path="./plan8-api.d.ts" />

// xterm.js loaded globally via script tags
declare const Terminal: typeof import("xterm").Terminal;
declare const FitAddon: { FitAddon: typeof import("@xterm/addon-fit").FitAddon };

// --- Types ---

interface Sandbox {
  name: string;
  image: string;
  profileId: string;
  prompt: string;
}

interface Profile {
  id: string;
  description: string;
  prompt: string;
  dockerfile: string;
}

type ViewName =
  | "setup"
  | "empty"
  | "settings"
  | "profile-editor"
  | "sandbox-detail";

// --- State ---

const state: {
  sandboxes: Sandbox[];
  profiles: Profile[];
  currentView: ViewName;
  selectedSandbox: Sandbox | null;
  editingProfile: Profile | null;
  ready: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
} = {
  sandboxes: [],
  profiles: [],
  currentView: "setup",
  selectedSandbox: null,
  editingProfile: null,
  ready: false,
  pollTimer: null,
};

// --- Terminal instances per sandbox ---
// Keys are "sandboxName" for agent sessions, "sandboxName:shell" for shell sessions

const activePtys = new Set<string>();
const terminals = new Map<
  string,
  { term: InstanceType<typeof Terminal>; fitAddon: InstanceType<typeof FitAddon.FitAddon> }
>();

// Track which session tab is active per sandbox: "agent" or "shell"
const activeSession = new Map<string, "agent" | "shell">();
// Track which sandboxes have a shell connection
const shellConnected = new Set<string>();

// --- Helpers ---

function getElementById<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

// --- Views ---

const views: Record<ViewName, HTMLElement> = {
  setup: getElementById("view-setup"),
  empty: getElementById("view-empty"),
  settings: getElementById("view-settings"),
  "profile-editor": getElementById("view-profile-editor"),
  "sandbox-detail": getElementById("view-sandbox-detail"),
};

function showView(name: ViewName): void {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
  state.currentView = name;

  const appEl = getElementById("app");
  appEl.classList.toggle("setup-mode", name === "setup");

  document.querySelectorAll<HTMLElement>(".sandbox-tab").forEach((el) => {
    el.classList.toggle(
      "active",
      name === "sandbox-detail" &&
        state.selectedSandbox !== null &&
        el.dataset.name === state.selectedSandbox.name
    );
  });
  const settingsNav = document.getElementById("nav-settings");
  if (settingsNav)
    settingsNav.classList.toggle(
      "active",
      name === "settings" || name === "profile-editor"
    );

  // Fit terminal when switching to sandbox detail
  if (name === "sandbox-detail" && state.selectedSandbox) {
    const session = activeSession.get(state.selectedSandbox.name) || "agent";
    const key = terminalKey(state.selectedSandbox.name, session);
    const entry = terminals.get(key);
    if (entry) {
      requestAnimationFrame(() => entry.fitAddon.fit());
    }
  }
}

// --- Setup flow ---

const setupStatus = getElementById<HTMLParagraphElement>("setup-status");
const setupDetail = getElementById<HTMLParagraphElement>("setup-detail");
const setupCommands = getElementById<HTMLDivElement>("setup-commands");

function stopPolling(): void {
  if (state.pollTimer !== null) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startPolling(): void {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    const result = await window.plan8.setup.check();
    if (result.status === "ready") {
      stopPolling();
      enterApp();
    } else if (result.status === "not-installed") {
      showSetupInstall();
    } else if (result.status === "not-running") {
      showSetupStart();
    }
  }, 2000);
}

function showSetupInstall(): void {
  setupStatus.textContent = "apple/container is not installed";
  setupCommands.innerHTML = `<div class="setup-cmd-block"><p class="setup-cmd-label">download the installer from github:</p><a id="link-releases" class="setup-link">github.com/apple/container/releases</a></div>`;
  const link = getElementById<HTMLAnchorElement>("link-releases");
  link.addEventListener("click", (e) => {
    e.preventDefault();
    window.plan8.setup.openReleases();
  });
  setupDetail.textContent = "waiting for container to be installed...";
}

function showSetupStart(): void {
  setupStatus.textContent = "container is installed but not running";
  setupCommands.innerHTML = `<div class="setup-cmd-block"><p class="setup-cmd-label">run in your terminal:</p><code class="setup-cmd">container system start</code></div>`;
  setupDetail.textContent = "waiting for service to start...";
}

async function runSetup(): Promise<void> {
  showView("setup");
  setupStatus.textContent = "checking environment...";
  setupDetail.textContent = "";
  setupCommands.innerHTML = "";

  const result = await window.plan8.setup.check();

  if (result.status === "ready") {
    enterApp();
    return;
  }

  if (result.status === "not-installed") {
    showSetupInstall();
  } else {
    showSetupStart();
  }

  getElementById("app").classList.add("loaded");
  startPolling();
}

async function enterApp(): Promise<void> {
  stopPolling();
  state.ready = true;
  state.profiles = await window.plan8.profiles.list();
  showView("empty");
  getElementById("app").classList.add("loaded");
  refresh();
}

// --- Navigation ---

getElementById("nav-settings").addEventListener("click", () => {
  if (!state.ready) return;
  state.selectedSandbox = null;
  openSettings();
});

// --- Settings: profile list ---

async function openSettings(): Promise<void> {
  state.profiles = await window.plan8.profiles.list();
  renderProfileList();
  showView("settings");
}

function renderProfileList(): void {
  const list = getElementById("profile-list");
  if (state.profiles.length === 0) {
    list.innerHTML = '<div class="empty">no profiles configured</div>';
    return;
  }
  list.innerHTML = state.profiles
    .map(
      (p) => `
    <div class="list-item" data-id="${p.id}">
      <div>
        <span class="name">${p.id}</span>
        <span class="meta">${p.description}</span>
      </div>
    </div>
  `
    )
    .join("");
  list.querySelectorAll<HTMLElement>(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      const profile = state.profiles.find((p) => p.id === el.dataset.id);
      if (profile) openProfileEditor(profile, false);
    });
  });
}

getElementById("btn-new-profile").addEventListener("click", () => {
  openProfileEditor(
    {
      id: "",
      description: "",
      prompt: "",
      dockerfile: "FROM ubuntu:latest\n",
    },
    true
  );
});

// --- Profile editor ---

function openProfileEditor(profile: Profile, isNew: boolean): void {
  state.editingProfile = { ...profile };
  const idInput = getElementById<HTMLInputElement>("editor-id");
  getElementById("editor-title").textContent = isNew
    ? "new profile"
    : profile.id;
  idInput.value = profile.id;
  idInput.readOnly = !isNew;
  idInput.classList.toggle("readonly", !isNew);
  getElementById<HTMLInputElement>("editor-description").value =
    profile.description;
  getElementById<HTMLTextAreaElement>("editor-prompt").value = profile.prompt;
  getElementById<HTMLTextAreaElement>("editor-dockerfile").value =
    profile.dockerfile;

  const deleteBtn = getElementById("btn-delete-profile");
  deleteBtn.style.display = isNew ? "none" : "inline-block";

  showView("profile-editor");
}

getElementById("btn-back-settings").addEventListener("click", () => {
  openSettings();
});

getElementById("btn-save-profile").addEventListener("click", async () => {
  const id = getElementById<HTMLInputElement>("editor-id").value.trim();
  const description = getElementById<HTMLInputElement>(
    "editor-description"
  ).value.trim();
  const prompt = getElementById<HTMLTextAreaElement>("editor-prompt").value;
  const dockerfile =
    getElementById<HTMLTextAreaElement>("editor-dockerfile").value;

  if (!id) return;

  await window.plan8.profiles.save({ id, description, prompt, dockerfile });
  await openSettings();
});

getElementById("btn-delete-profile").addEventListener("click", async () => {
  if (!state.editingProfile || !state.editingProfile.id) return;
  if (state.editingProfile.id === "default") return;
  await window.plan8.profiles.delete(state.editingProfile.id);
  await openSettings();
});

// --- Sidebar sandbox list ---

function renderSandboxList(): void {
  const list = getElementById("sandbox-list");
  if (state.sandboxes.length === 0) {
    list.innerHTML = '<div class="sandbox-empty">no sandboxes</div>';
    return;
  }
  list.innerHTML = state.sandboxes
    .map(
      (s) =>
        `<button class="sandbox-tab${state.selectedSandbox && state.selectedSandbox.name === s.name ? " active" : ""}" data-name="${s.name}">${s.name}</button>`
    )
    .join("");
  list.querySelectorAll<HTMLButtonElement>(".sandbox-tab").forEach((el) => {
    el.addEventListener("click", () => {
      const sandbox = state.sandboxes.find((s) => s.name === el.dataset.name);
      if (sandbox) openSandboxDetail(sandbox);
    });
  });
}

// --- Terminal management ---

function getOrCreateTerminal(
  name: string
): { term: InstanceType<typeof Terminal>; fitAddon: InstanceType<typeof FitAddon.FitAddon> } {
  let entry = terminals.get(name);
  if (entry) return entry;

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: '"Berkeley Mono", "SF Mono", "Menlo", "Consolas", monospace',
    theme: {
      background: "#0a0a0a",
      foreground: "#c8c8c8",
      cursor: "#c8c8c8",
      selectionBackground: "#333333",
      black: "#0a0a0a",
      brightBlack: "#555555",
      white: "#c8c8c8",
      brightWhite: "#e8e8e8",
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  // Send keystrokes to PTY
  term.onData((data: string) => {
    window.plan8.pty.write(name, data);
  });

  // Send resize events
  term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    window.plan8.pty.resize(name, cols, rows);
  });

  entry = { term, fitAddon };
  terminals.set(name, entry);
  return entry;
}

function terminalKey(sandboxName: string, session: "agent" | "shell"): string {
  return session === "shell" ? `${sandboxName}:shell` : sandboxName;
}

function attachTerminalToContainer(termKey: string): void {
  const container = getElementById("terminal-container");
  // Detach any existing terminal DOM
  container.innerHTML = "";

  const { term, fitAddon } = getOrCreateTerminal(termKey);
  term.open(container);
  requestAnimationFrame(() => {
    fitAddon.fit();
    term.focus();
  });
}

function updateSessionTabs(sandboxName: string): void {
  const tabsEl = getElementById("session-tabs");
  const session = activeSession.get(sandboxName) || "agent";
  const hasShell = shellConnected.has(sandboxName);

  // Show tabs only if shell is connected
  tabsEl.classList.toggle("visible", hasShell);

  tabsEl.querySelectorAll<HTMLElement>(".session-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.session === session);
  });
}

function switchSession(sandboxName: string, session: "agent" | "shell"): void {
  activeSession.set(sandboxName, session);
  const key = terminalKey(sandboxName, session);
  attachTerminalToContainer(key);
  updateSessionTabs(sandboxName);
}

// --- Sandbox detail ---

async function openSandboxDetail(sandbox: Sandbox): Promise<void> {
  state.selectedSandbox = sandbox;
  getElementById("detail-name").textContent = sandbox.name;
  getElementById("detail-profile-label").textContent = sandbox.profileId;

  const session = activeSession.get(sandbox.name) || "agent";
  const key = terminalKey(sandbox.name, session);

  showView("sandbox-detail");
  attachTerminalToContainer(key);
  updateSessionTabs(sandbox.name);

  // Spawn PTY if not already running for this sandbox (agent session)
  if (!activePtys.has(sandbox.name)) {
    const entry = terminals.get(sandbox.name);
    const cols = entry ? entry.term.cols : 80;
    const rows = entry ? entry.term.rows : 24;
    try {
      await window.plan8.pty.spawn(
        sandbox.name,
        "/usr/local/bin/container",
        ["exec", "-it", "-w", `/user/${sandbox.name}`, sandbox.name, "pi", "-c"],
        cols,
        rows
      );
      activePtys.add(sandbox.name);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (entry) entry.term.writeln(`\r\nerror: ${message}`);
    }
  }
}

getElementById("btn-stop").addEventListener("click", async () => {
  if (!state.selectedSandbox) return;
  const name = state.selectedSandbox.name;
  try {
    await window.plan8.container.stop({ name });
    // Clean up agent terminal
    const agentEntry = terminals.get(name);
    if (agentEntry) {
      agentEntry.term.dispose();
      terminals.delete(name);
    }
    // Clean up shell terminal
    const shellKey = terminalKey(name, "shell");
    const shellEntry = terminals.get(shellKey);
    if (shellEntry) {
      shellEntry.term.dispose();
      terminals.delete(shellKey);
    }
    activePtys.delete(name);
    activePtys.delete(shellKey);
    shellConnected.delete(name);
    activeSession.delete(name);
    state.sandboxes = state.sandboxes.filter((s) => s.name !== name);
    state.selectedSandbox = null;
    renderSandboxList();
    showView("empty");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const entry = terminals.get(name);
    if (entry) entry.term.writeln(`\r\nerror: ${message}`);
  }
});

// --- Connect to machine (shell session) ---

getElementById("btn-connect").addEventListener("click", async () => {
  if (!state.selectedSandbox) return;
  const name = state.selectedSandbox.name;
  const shellKey = terminalKey(name, "shell");

  if (shellConnected.has(name)) {
    // Already connected, just switch to shell tab
    switchSession(name, "shell");
    return;
  }

  // Create shell terminal and spawn bash PTY
  const { term, fitAddon } = getOrCreateTerminal(shellKey);
  shellConnected.add(name);
  activeSession.set(name, "shell");
  attachTerminalToContainer(shellKey);
  updateSessionTabs(name);

  const cols = term.cols;
  const rows = term.rows;

  try {
    await window.plan8.pty.spawn(
      shellKey,
      "/usr/local/bin/container",
      ["exec", "-it", "-w", `/user/${name}`, name, "bash"],
      cols,
      rows
    );
    activePtys.add(shellKey);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    term.writeln(`\r\nerror: ${message}`);
  }
});

// --- Session tab switching ---

getElementById("session-tabs").addEventListener("click", (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest(".session-tab") as HTMLElement | null;
  if (!target || !state.selectedSandbox) return;
  const session = target.dataset.session as "agent" | "shell";
  if (session) switchSession(state.selectedSandbox.name, session);
});

// --- New sandbox modal ---

getElementById("btn-new-sandbox").addEventListener("click", async () => {
  if (!state.ready) return;
  state.profiles = await window.plan8.profiles.list();
  showNewSandboxModal();
});

function showNewSandboxModal(): void {
  const options = state.profiles
    .map(
      (p) =>
        `<option value="${p.id}">${p.id} — ${p.description}</option>`
    )
    .join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h2>new sandbox</h2>
      <div class="field">
        <label>name</label>
        <input id="modal-name" type="text" placeholder="my-sandbox" autocomplete="off" />
      </div>
      <div class="field">
        <label>profile</label>
        <select id="modal-profile">${options}</select>
      </div>
      <div class="modal-actions">
        <button class="btn" id="modal-cancel">cancel</button>
        <button class="btn" id="modal-create">create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancelBtn = overlay.querySelector("#modal-cancel") as HTMLButtonElement;
  cancelBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  const createBtn = overlay.querySelector("#modal-create") as HTMLButtonElement;
  createBtn.addEventListener("click", async () => {
    const rawName = (
      overlay.querySelector("#modal-name") as HTMLInputElement
    ).value.trim();
    // Sanitize: lowercase, replace spaces/invalid chars with dashes
    const name = rawName.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    const profileId = (overlay.querySelector("#modal-profile") as HTMLSelectElement)
      .value;
    if (!name || !profileId) return;

    const profile = state.profiles.find((p) => p.id === profileId);
    if (!profile) return;

    const sandbox: Sandbox = {
      name,
      image: "ubuntu:latest",
      profileId,
      prompt: profile.prompt,
    };
    state.sandboxes.push(sandbox);
    renderSandboxList();
    // Mark PTY as active before opening detail to prevent reconnect spawn
    activePtys.add(name);
    openSandboxDetail(sandbox);
    overlay.remove();

    const entry = terminals.get(name);
    if (entry) entry.term.writeln("creating sandbox...");

    try {
      await window.plan8.container.run({
        name,
        image: "ubuntu:latest",
        profileId,
      });

      if (entry) entry.term.writeln("sandbox ready. starting harness...\r\n");

      // Spawn pi harness (or bash fallback) inside the container via PTY
      const { cols, rows } = entry
        ? { cols: entry.term.cols, rows: entry.term.rows }
        : { cols: 80, rows: 24 };

      await window.plan8.pty.spawn(
        name,
        "/usr/local/bin/container",
        ["exec", "-it", "-w", `/user/${name}`, name, "pi"],
        cols,
        rows
      );
      activePtys.add(name);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (entry) entry.term.writeln(`\r\nerror: ${message}`);
      state.sandboxes = state.sandboxes.filter((s) => s.name !== name);
      renderSandboxList();
    }
  });

  (overlay.querySelector("#modal-name") as HTMLInputElement).focus();
}

// --- PTY data routing ---

window.plan8.pty.onData((name: string, data: string) => {
  const entry = terminals.get(name);
  if (entry) entry.term.write(data);
});

window.plan8.pty.onExit(async (name: string, _exitCode: number) => {
  activePtys.delete(name);

  // Check if this is a shell session exit (key ends with :shell)
  if (name.endsWith(":shell")) {
    const sandboxName = name.replace(/:shell$/, "");
    const entry = terminals.get(name);
    if (entry) {
      entry.term.writeln("\r\n[shell disconnected]");
    }
    shellConnected.delete(sandboxName);
    // Switch back to agent tab if we're viewing this shell
    if (state.selectedSandbox?.name === sandboxName && activeSession.get(sandboxName) === "shell") {
      switchSession(sandboxName, "agent");
    }
    updateSessionTabs(sandboxName);
    return;
  }

  // Agent session exited — clean up everything
  const entry = terminals.get(name);
  if (entry) {
    entry.term.dispose();
    terminals.delete(name);
  }

  // Also clean up shell terminal if it exists
  const shellKey = `${name}:shell`;
  const shellEntry = terminals.get(shellKey);
  if (shellEntry) {
    shellEntry.term.dispose();
    terminals.delete(shellKey);
  }
  shellConnected.delete(name);
  activeSession.delete(name);

  // Stop and remove container
  try {
    await window.plan8.container.stop({ name });
  } catch {
    // already stopped
  }

  state.sandboxes = state.sandboxes.filter((s) => s.name !== name);
  if (state.selectedSandbox?.name === name) {
    state.selectedSandbox = null;
    showView("empty");
  }
  renderSandboxList();
});

// --- Container output (for run progress) ---

window.plan8.container.onOutput((name: string, line: string) => {
  const entry = terminals.get(name);
  if (entry) entry.term.writeln(line);
});

// --- Resize handling ---

window.addEventListener("resize", () => {
  if (
    state.currentView === "sandbox-detail" &&
    state.selectedSandbox
  ) {
    const session = activeSession.get(state.selectedSandbox.name) || "agent";
    const key = terminalKey(state.selectedSandbox.name, session);
    const entry = terminals.get(key);
    if (entry) entry.fitAddon.fit();
  }
});

// --- Initial load ---

async function refresh(): Promise<void> {
  try {
    const containers = await window.plan8.container.list();
    if (Array.isArray(containers)) {
      state.sandboxes = containers
        .filter((c) => {
          if (c.status !== "running") return false;
          const labels = (c.configuration as Record<string, unknown>)
            ?.labels as Record<string, string> | undefined;
          return labels?.["plan8"] === "true";
        })
        .map((c) => {
          const config = c.configuration as Record<string, unknown> | undefined;
          const labels = config?.labels as Record<string, string> | undefined;
          const id = (config?.id as string) ?? "unknown";
          const imageRef = (config?.image as Record<string, unknown>)
            ?.reference as string | undefined;
          return {
            name: id,
            image: imageRef ?? "",
            profileId: labels?.["plan8.profile"] ?? "",
            prompt: "",
          };
        });
    }
  } catch {
    // container CLI not available
  }
  renderSandboxList();
}

// --- Boot ---

runSetup();
