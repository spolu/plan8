import fs from "fs";
import path from "path";
import os from "os";
import type { AgentProfile } from "./plan8-api";

const PLAN8_DIR = path.join(os.homedir(), ".plan8");
export const AGENTS_DIR = path.join(PLAN8_DIR, "agents");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DEFAULT_PROMPT = `You are a general-purpose assistant running inside a Linux container.
You have access to the filesystem and can run commands.
Help the user with their tasks.
`;

const DEFAULT_DOCKERFILE = `FROM ubuntu:latest

ARG AGENT_NAME=default

RUN apt-get update && apt-get install -y \\
    curl \\
    git \\
    vim \\
    ca-certificates \\
    openssh-client \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\
    && apt-get install -y nodejs \\
    && rm -rf /var/lib/apt/lists/*

# Install gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \\
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \\
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \\
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \\
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
    && apt-get update && apt-get install -y gh \\
    && rm -rf /var/lib/apt/lists/*

# Install pi coding agent
RUN npm install -g @mariozechner/pi-coding-agent

# Copy credentials (staged at build time, empty defaults if not present)
RUN mkdir -p /root/.pi/agent /root/.ssh /root/.config/gh
COPY auth.json /root/.pi/agent/auth.json
COPY .gitconfig /root/.gitconfig
COPY .ssh/ /root/.ssh/
RUN chmod 700 /root/.ssh && (chmod 600 /root/.ssh/* 2>/dev/null || true)
COPY gh_hosts.yml /root/.config/gh/hosts.yml

# Set working directory to /user/{agent_name}
RUN mkdir -p /user/\${AGENT_NAME}
WORKDIR /user/\${AGENT_NAME}
`;

export function ensureDefaults(): void {
  ensureDir(AGENTS_DIR);
  const defaultDir = path.join(AGENTS_DIR, "default");
  const isNew = !fs.existsSync(defaultDir);
  ensureDir(defaultDir);

  if (isNew) {
    fs.writeFileSync(
      path.join(defaultDir, "settings.json"),
      JSON.stringify(
        { name: "default", description: "General-purpose agent" },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(defaultDir, "prompt.md"), DEFAULT_PROMPT);
  }

  // Always sync the default Dockerfile with the latest template
  fs.writeFileSync(path.join(defaultDir, "Dockerfile"), DEFAULT_DOCKERFILE);
}

export function listAgents(): AgentProfile[] {
  ensureDir(AGENTS_DIR);
  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  const agents: AgentProfile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      agents.push(getAgent(entry.name));
    } catch {
      // skip malformed agent dirs
    }
  }
  return agents;
}

export function getAgent(id: string): AgentProfile {
  const dir = path.join(AGENTS_DIR, id);
  const settingsPath = path.join(dir, "settings.json");
  const promptPath = path.join(dir, "prompt.md");
  const dockerfilePath = path.join(dir, "Dockerfile");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
    name: string;
    description: string;
  };
  const prompt = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, "utf-8")
    : "";
  const dockerfile = fs.existsSync(dockerfilePath)
    ? fs.readFileSync(dockerfilePath, "utf-8")
    : "";

  return {
    id,
    name: settings.name,
    description: settings.description,
    prompt,
    dockerfile,
  };
}

export function saveAgent(agent: AgentProfile): void {
  const dir = path.join(AGENTS_DIR, agent.id);
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify(
      { name: agent.name, description: agent.description },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(dir, "prompt.md"), agent.prompt);
  fs.writeFileSync(path.join(dir, "Dockerfile"), agent.dockerfile);
}

export function deleteAgent(id: string): void {
  const dir = path.join(AGENTS_DIR, id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}
