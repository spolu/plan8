/// <reference path="./plan8-api.d.ts" />

// --- Types ---

interface Sandbox {
  name: string;
  image: string;
  prompt: string;
}

type ViewName = "setup" | "empty" | "messages" | "sandbox-detail";

// --- State ---

const state: {
  sandboxes: Sandbox[];
  messages: string[];
  currentView: ViewName;
  selectedSandbox: Sandbox | null;
  ready: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
} = {
  sandboxes: [],
  messages: [],
  currentView: "setup",
  selectedSandbox: null,
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
  messages: getElementById("view-messages"),
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
  const msgNav = document.getElementById("nav-messages");
  if (msgNav) msgNav.classList.toggle("active", name === "messages");
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
  setupDetail.textContent =
    "download and install the latest release, then come back here.";
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

function enterApp(): void {
  stopPolling();
  state.ready = true;
  showView("empty");
  getElementById("app").classList.add("loaded");
  refresh();
}

// --- Navigation ---

getElementById("nav-messages").addEventListener("click", () => {
  if (!state.ready) return;
  state.selectedSandbox = null;
  showView("messages");
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

// --- New sandbox modal ---

getElementById("btn-new-sandbox").addEventListener("click", () => {
  if (!state.ready) return;
  showNewSandboxModal();
});

function showNewSandboxModal(): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h2>new sandbox</h2>
      <div class="field">
        <label>name</label>
        <input id="modal-name" type="text" placeholder="my-agent" autocomplete="off" />
      </div>
      <div class="field">
        <label>image</label>
        <input id="modal-image" type="text" placeholder="ubuntu:latest" autocomplete="off" />
      </div>
      <div class="field">
        <label>prompt</label>
        <textarea id="modal-prompt" placeholder="you are an agent that..."></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn" id="modal-cancel">cancel</button>
        <button class="btn" id="modal-create">create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancelBtn = overlay.querySelector("#modal-cancel") as HTMLButtonElement;
  cancelBtn.addEventListener("click", () => {
    overlay.remove();
  });
  overlay.addEventListener("click", (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  const createBtn = overlay.querySelector("#modal-create") as HTMLButtonElement;
  createBtn.addEventListener("click", async () => {
    const nameInput = overlay.querySelector("#modal-name") as HTMLInputElement;
    const imageInput = overlay.querySelector("#modal-image") as HTMLInputElement;
    const promptInput = overlay.querySelector(
      "#modal-prompt"
    ) as HTMLTextAreaElement;
    const name = nameInput.value.trim();
    const image = imageInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!name || !image) return;

    // Add sandbox immediately, switch to detail, close modal
    const sandbox: Sandbox = { name, image, prompt };
    state.sandboxes.push(sandbox);
    renderSandboxList();
    openSandboxDetail(sandbox);
    overlay.remove();
    appendOutput("creating sandbox...");

    try {
      await window.plan8.container.run({ name, image });
      appendOutput("sandbox ready.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      appendOutput(`error: ${message}`);
      // Remove failed sandbox
      state.sandboxes = state.sandboxes.filter((s) => s.name !== name);
      renderSandboxList();
    }
  });

  const nameField = overlay.querySelector("#modal-name") as HTMLInputElement;
  nameField.focus();
}

// --- Initial load ---

async function refresh(): Promise<void> {
  try {
    const containers = await window.plan8.container.list();
    if (Array.isArray(containers)) {
      state.sandboxes = containers.map((c) => ({
        name: c.name ?? c.Name ?? "unknown",
        image: c.image ?? c.Image ?? "",
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
