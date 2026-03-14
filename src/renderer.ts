/// <reference path="./plan8-api.d.ts" />

// --- Types ---

interface Sandbox {
  name: string;
  image: string;
  agentId: string;
  prompt: string;
}

interface AgentProfile {
  id: string;
  name: string;
  description: string;
  prompt: string;
  dockerfile: string;
}

type ViewName =
  | "setup"
  | "empty"
  | "settings"
  | "agent-editor"
  | "sandbox-detail";

// --- State ---

const state: {
  sandboxes: Sandbox[];
  agents: AgentProfile[];
  currentView: ViewName;
  selectedSandbox: Sandbox | null;
  editingAgent: AgentProfile | null;
  ready: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
} = {
  sandboxes: [],
  agents: [],
  currentView: "setup",
  selectedSandbox: null,
  editingAgent: null,
  ready: false,
  pollTimer: null,
};

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
  "agent-editor": getElementById("view-agent-editor"),
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
      name === "settings" || name === "agent-editor"
    );
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
  state.agents = await window.plan8.agents.list();
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

// --- Settings: agent list ---

async function openSettings(): Promise<void> {
  state.agents = await window.plan8.agents.list();
  renderAgentList();
  showView("settings");
}

function renderAgentList(): void {
  const list = getElementById("agent-list");
  if (state.agents.length === 0) {
    list.innerHTML = '<div class="empty">no agents configured</div>';
    return;
  }
  list.innerHTML = state.agents
    .map(
      (a) => `
    <div class="list-item" data-id="${a.id}">
      <div>
        <span class="name">${a.name}</span>
        <span class="meta">${a.description}</span>
      </div>
    </div>
  `
    )
    .join("");
  list.querySelectorAll<HTMLElement>(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      const agent = state.agents.find((a) => a.id === el.dataset.id);
      if (agent) openAgentEditor(agent, false);
    });
  });
}

getElementById("btn-new-agent").addEventListener("click", () => {
  openAgentEditor(
    { id: "", name: "", description: "", prompt: "", dockerfile: "FROM ubuntu:latest\n" },
    true
  );
});

// --- Agent editor ---

function openAgentEditor(agent: AgentProfile, isNew: boolean): void {
  state.editingAgent = { ...agent };
  const idInput = getElementById<HTMLInputElement>("editor-id");
  getElementById("editor-title").textContent = isNew
    ? "new agent"
    : agent.name;
  idInput.value = agent.id;
  idInput.readOnly = !isNew;
  idInput.classList.toggle("readonly", !isNew);
  getElementById<HTMLInputElement>("editor-name").value = agent.name;
  getElementById<HTMLInputElement>("editor-description").value =
    agent.description;
  getElementById<HTMLTextAreaElement>("editor-prompt").value = agent.prompt;
  getElementById<HTMLTextAreaElement>("editor-dockerfile").value =
    agent.dockerfile;

  const deleteBtn = getElementById("btn-delete-agent");
  deleteBtn.style.display = isNew ? "none" : "inline-block";

  showView("agent-editor");
}

getElementById("btn-back-settings").addEventListener("click", () => {
  openSettings();
});

getElementById("btn-save-agent").addEventListener("click", async () => {
  const id = getElementById<HTMLInputElement>("editor-id").value.trim();
  const name = getElementById<HTMLInputElement>("editor-name").value.trim();
  const description = getElementById<HTMLInputElement>(
    "editor-description"
  ).value.trim();
  const prompt =
    getElementById<HTMLTextAreaElement>("editor-prompt").value;
  const dockerfile =
    getElementById<HTMLTextAreaElement>("editor-dockerfile").value;

  if (!id || !name) return;

  await window.plan8.agents.save({ id, name, description, prompt, dockerfile });
  await openSettings();
});

getElementById("btn-delete-agent").addEventListener("click", async () => {
  if (!state.editingAgent || !state.editingAgent.id) return;
  if (state.editingAgent.id === "default") return; // protect default
  await window.plan8.agents.delete(state.editingAgent.id);
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

// --- Sandbox detail ---

function openSandboxDetail(sandbox: Sandbox): void {
  state.selectedSandbox = sandbox;
  getElementById("detail-name").textContent = sandbox.name;
  getElementById("detail-agent-label").textContent = sandbox.agentId;
  getElementById("detail-prompt").textContent =
    sandbox.prompt || "(no prompt)";
  getElementById("detail-files").innerHTML =
    '<div class="empty">no files</div>';
  getElementById("detail-output").textContent = "";
  showView("sandbox-detail");
}

getElementById("btn-stop").addEventListener("click", async () => {
  if (!state.selectedSandbox) return;
  try {
    await window.plan8.container.stop({ name: state.selectedSandbox.name });
    state.sandboxes = state.sandboxes.filter(
      (s) => s.name !== state.selectedSandbox?.name
    );
    state.selectedSandbox = null;
    renderSandboxList();
    showView("empty");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    appendOutput(`error: ${message}`);
  }
});

// --- Shell input ---

const detailInput = getElementById<HTMLInputElement>("detail-input");
detailInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key !== "Enter") return;
  const cmd = detailInput.value.trim();
  if (!cmd || !state.selectedSandbox) return;
  detailInput.value = "";
  appendOutput(`$ ${cmd}`);
  window.plan8.shell.send(state.selectedSandbox.name, cmd);
});

function appendOutput(text: string): void {
  const el = getElementById("detail-output");
  el.textContent += text + "\n";
  el.scrollTop = el.scrollHeight;
}

// --- New sandbox modal (dropdown) ---

getElementById("btn-new-sandbox").addEventListener("click", async () => {
  if (!state.ready) return;
  state.agents = await window.plan8.agents.list();
  showNewSandboxModal();
});

function showNewSandboxModal(): void {
  const options = state.agents
    .map(
      (a) =>
        `<option value="${a.id}">${a.name} — ${a.description}</option>`
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
        <label>agent</label>
        <select id="modal-agent">${options}</select>
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
    const name = (
      overlay.querySelector("#modal-name") as HTMLInputElement
    ).value.trim();
    const agentId = (overlay.querySelector("#modal-agent") as HTMLSelectElement)
      .value;
    if (!name || !agentId) return;

    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) return;

    const sandbox: Sandbox = {
      name,
      image: "ubuntu:latest", // will come from Dockerfile later
      agentId,
      prompt: agent.prompt,
    };
    state.sandboxes.push(sandbox);
    renderSandboxList();
    openSandboxDetail(sandbox);
    overlay.remove();
    appendOutput("creating sandbox...");

    try {
      await window.plan8.container.run({
        name,
        image: "ubuntu:latest",
        agentId,
      });
      appendOutput("sandbox ready.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      appendOutput(`error: ${message}`);
      state.sandboxes = state.sandboxes.filter((s) => s.name !== name);
      renderSandboxList();
    }
  });

  (overlay.querySelector("#modal-name") as HTMLInputElement).focus();
}

// --- Initial load ---

async function refresh(): Promise<void> {
  try {
    const containers = await window.plan8.container.list();
    if (Array.isArray(containers)) {
      state.sandboxes = containers.map((c) => ({
        name: c.name ?? c.Name ?? "unknown",
        image: c.image ?? c.Image ?? "",
        agentId: "",
        prompt: "",
      }));
    }
  } catch {
    // container CLI not available
  }
  renderSandboxList();
}

// --- Container output streaming ---

window.plan8.container.onOutput((name: string, line: string) => {
  if (state.selectedSandbox && state.selectedSandbox.name === name) {
    appendOutput(line);
  }
});

// --- Boot ---

runSetup();
