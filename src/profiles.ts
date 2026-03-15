import fs from "fs";
import path from "path";
import os from "os";
import type { Profile } from "./plan8-api";

const PLAN8_DIR = path.join(os.homedir(), ".plan8");
export const PROFILES_DIR = path.join(PLAN8_DIR, "profiles");
export const SKILLS_DIR = path.join(PLAN8_DIR, "skills");

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
    ca-certificates \\
    openssh-client \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\
    && apt-get install -y nodejs \\
    && rm -rf /var/lib/apt/lists/*

# Install pi coding agent
RUN npm install -g @mariozechner/pi-coding-agent

# Copy credentials (staged at build time, empty defaults if not present)
RUN mkdir -p /root/.pi/agent /root/.ssh
COPY auth.json /root/.pi/agent/auth.json
COPY .gitconfig /root/.gitconfig
COPY .ssh/ /root/.ssh/
RUN chmod 700 /root/.ssh && (chmod 600 /root/.ssh/* 2>/dev/null || true)

# Working directory (volume mounted from host, subdirectory created at runtime)
WORKDIR /agent
`;

export function ensureDefaults(): void {
  ensureDir(PROFILES_DIR);
  ensureDir(SKILLS_DIR);
  const defaultDir = path.join(PROFILES_DIR, "default");
  const isNew = !fs.existsSync(defaultDir);
  ensureDir(defaultDir);
  ensureDir(path.join(defaultDir, "skills"));

  if (isNew) {
    fs.writeFileSync(
      path.join(defaultDir, "settings.json"),
      JSON.stringify(
        { description: "General-purpose agent" },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(defaultDir, "prompt.md"), DEFAULT_PROMPT);
  }

  // Always sync the default Dockerfile with the latest template
  fs.writeFileSync(path.join(defaultDir, "Dockerfile"), DEFAULT_DOCKERFILE);
}

export function listProfiles(): Profile[] {
  ensureDir(PROFILES_DIR);
  const entries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
  const profiles: Profile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      profiles.push(getProfile(entry.name));
    } catch {
      // skip malformed profile dirs
    }
  }
  return profiles;
}

export function getProfile(id: string): Profile {
  const dir = path.join(PROFILES_DIR, id);
  const settingsPath = path.join(dir, "settings.json");
  const promptPath = path.join(dir, "prompt.md");
  const dockerfilePath = path.join(dir, "Dockerfile");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
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
    description: settings.description,
    prompt,
    dockerfile,
  };
}

export function saveProfile(profile: Profile): void {
  const dir = path.join(PROFILES_DIR, profile.id);
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify(
      { description: profile.description },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(dir, "prompt.md"), profile.prompt);
  fs.writeFileSync(path.join(dir, "Dockerfile"), profile.dockerfile);
}

export function linkSkills(profileId: string, agentDir: string): void {
  const profileSkillsDir = path.join(PROFILES_DIR, profileId, "skills");
  const targetDir = path.join(agentDir, ".skills");

  ensureDir(targetDir);

  if (!fs.existsSync(profileSkillsDir)) return;

  const entries = fs.readdirSync(profileSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(profileSkillsDir, entry.name);
    const dest = path.join(targetDir, entry.name);
    // Skip if already exists in target
    if (fs.existsSync(dest)) continue;
    // Resolve the real path (profile skills may be symlinks into ~/.plan8/skills/)
    let realSrc = src;
    try {
      realSrc = fs.realpathSync(src);
    } catch {
      continue; // broken symlink, skip
    }
    fs.symlinkSync(realSrc, dest);
  }
}

export function deleteProfile(id: string): void {
  const dir = path.join(PROFILES_DIR, id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
}
