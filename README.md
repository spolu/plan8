```
        ___  __            ___
       / _ \/ /__ ____    ( _ )
      / ___/ / _ `/ _ \  / _  |
     /_/  /_/\_,_/_//_/  \___/

```

Explorative agent orchestration desktop app built with Electron. Spin up isolated AI coding agents inside [apple/container](https://github.com/apple/container) Linux containers, each with its own terminal, profile, and shared filesystem. Where Plan 9 gave every resource a file, plan8 gives every agent a sandbox.

**Conclusion of exploration**: sandboxing requires a bit too much rigour + linux/MacOSX misalignment is meh.

<img width="1214" height="814" alt="Screenshot 2026-03-16 at 20 05 06" src="https://github.com/user-attachments/assets/fe69c1c5-887b-4126-be6c-bedc88b6f008" />

## Prerequisites

- **macOS** with [apple/container](https://github.com/apple/container/releases/latest) installed and running
- **Node.js** (for building)

## Setup

```bash
npm install
```

## Development

```bash
npm run build   # compile TypeScript
npm start       # build + launch Electron app
```

## How It Works

**Profiles** define the environment for agents — a Dockerfile, a system prompt (`AGENTS.md`), and an optional setup script. A `default` profile is created automatically with Ubuntu, Node.js 22, and the [pi coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).

**Agents** are named container instances. Creating an agent builds the profile's Docker image, starts a container with shared volumes, runs the setup script, then launches `pi` inside an embedded terminal (xterm.js). Each agent also has a **sandbox** shell session for direct container access.

Shared filesystem layout:

```
~/.plan8/
├── fs/agent/<name>/   # per-agent working directories (mounted at /agent)
├── profiles/          # profile configs (Dockerfile, AGENTS.md, setup.sh)
└── skills/            # shared skills directory
```

Host `~/.ssh` and `~/.pi` are mounted into containers for credentials.

## Packaging

```bash
npm run package   # create app bundle
npm run make      # create DMG installer
npm run publish   # publish to GitHub Releases
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New agent |
| `Cmd+Shift+[` | Previous agent |
| `Cmd+Shift+]` | Next agent |

## Architecture

```
src/
├── main.ts          # Electron main process — container/PTY management
├── preload.ts       # contextBridge API (plan8 namespace)
├── renderer.ts      # UI logic — views, terminals, agent lifecycle
├── profiles.ts      # Profile CRUD on ~/.plan8/profiles/
└── plan8-api.d.ts   # Shared TypeScript type definitions
```
