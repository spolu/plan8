import fs from "fs";
import path from "path";
import os from "os";
import type { AgentProfile } from "./plan8-api";

const PLAN8_DIR = path.join(os.homedir(), ".plan8");
const AGENTS_DIR = path.join(PLAN8_DIR, "agents");

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

RUN apt-get update && apt-get install -y \\
    curl \\
    git \\
    vim \\
    && rm -rf /var/lib/apt/lists/*
`;

export function ensureDefaults(): void {
  ensureDir(AGENTS_DIR);
  const defaultDir = path.join(AGENTS_DIR, "default");
  if (!fs.existsSync(defaultDir)) {
    ensureDir(defaultDir);
    fs.writeFileSync(
      path.join(defaultDir, "settings.json"),
      JSON.stringify(
        { name: "default", description: "General-purpose agent" },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(defaultDir, "prompt.md"), DEFAULT_PROMPT);
    fs.writeFileSync(path.join(defaultDir, "Dockerfile"), DEFAULT_DOCKERFILE);
  }
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
