# SenJoeru Synapse

**The Neural Network of Your AI Team**

A desktop AI Agent Operations Center designed to monitor, visualize, and coordinate AI coding agents running on a local developer workstation.

## Features

- Monitor AI agents (Claude, Devin, etc.)
- Track development tasks
- Visualize AI activities
- Monitor token usage and costs
- Track project progress
- Observe Git activity
- Display testing results
- Real-time updates
- Zero LLM token consumption for monitoring

## Tech Stack

- **Desktop**: Electron
- **Frontend**: React, TypeScript, Vite, TailwindCSS, shadcn/ui, Framer Motion, Recharts
- **Backend**: Node.js, Express
- **Monitoring**: File watchers, IPC

## Getting Started

### Let your agent do it

This repo ships an `AGENTS.md` that Claude Code and OpenCode read automatically.
Open the clone in either and say:

```
set this up for me
```

It installs, writes a config pointing at your repos, and tells you what will be
empty until you use it. Everything it writes is gitignored.

### Or by hand

**Requires:** Node.js 22+ (the OpenCode collector uses the built-in
`node:sqlite`), and Claude Code and/or OpenCode installed.

```bash
git clone <this-repo> senjoeru-synapse && cd senjoeru-synapse
npm install                                   # installs frontend, backend, collectors
cp metrics/config.example.json metrics/config.json
npm run dev
```

Edit `metrics/config.json` to point at your own repos — every field is optional
and sensible defaults apply, so it runs before you touch it:

| Field | Default |
|---|---|
| `claudeDir` | `<home>/.claude` |
| `repositories` | auto-detected from active sessions |
| `workspace.name` | "Workspace" |
| `opencodeDir` | `<home>/.local/share/opencode` |
| `opencodeServerUrl` | `http://127.0.0.1:4097` |
| `joeruKitDir` | a sibling `joeru-kit/` directory |

Each is also settable by environment variable — `SYNAPSE_CLAUDE_DIR`,
`SYNAPSE_OPENCODE_DIR`, `SYNAPSE_OPENCODE_URL`, `SYNAPSE_JOERU_KIT`.

`npm run dev` starts five processes: frontend, backend, collectors,
`opencode serve`, and Electron. Use `npm run dev:web` to skip Electron and open
the dashboard in a browser instead.

### What works without extra setup

Most of it. The dashboard reads whatever is already on your machine — Claude
sessions, git history, `~/.claude/tasks.json` if your agents write one. An empty
workspace shows empty pages rather than errors.

### What needs something extra

| Page | Needs |
|---|---|
| **Joeru → Chat** | `opencode serve` running — `npm run dev` starts it |
| **Joeru → Memory** | a [joeru-kit](https://github.com/SenpaiJoeru05/joeru-kit) checkout, for the memory files |
| **Joeru → Activity** | OpenCode installed; reads its database directly |
| **Tasks** | agents that write `~/.claude/tasks.json` |

Each degrades honestly — a page whose dependency is missing says what's missing
and how to provide it, rather than failing silently.

```bash
npm run build            # production frontend build
npm run build:electron   # package the desktop app
```

## Architecture

```
senjoeru-synapse/
├── electron/       Electron main process
├── frontend/       React dashboard
├── backend/        Express API + SQLite (the permanent store)
├── collectors/     file watchers — Claude sessions, git, OpenCode
├── shared/         workspace config, resolved from metrics/config.json
├── metrics/        derived JSON, rewritten each poll — a cache, not truth
└── docs/           architecture and roadmap
```

Four processes on localhost: Vite (5173), the API (3001), the collectors, and
`opencode serve` (4097). Electron wraps the first two.

**Related:** [joeru-kit](https://github.com/SenpaiJoeru05/joeru-kit) defines the
agents, skills, and memory that Synapse observes. Synapse is the cockpit; the
kit is the crew. Neither requires the other — Synapse works without it, minus
the Memory tab.

## Security

Synapse has two halves, and they have different guarantees. Being precise about
which is which matters more than a short list.

**The observer — zero-token, read-only.**
Collectors watch `~/.claude` and OpenCode's database and write derived metrics.
They never call a model and never modify a file they read. Everything on
Overview, Tasks, Git, Team, Intelligence, Insights, and Knowledge is computed
locally from files already on disk.

**The Joeru console — spends tokens, and acts.**
The Chat tab talks to a model through `opencode serve`, so it costs whatever
your provider charges. The agents it runs can read and edit files, subject to
OpenCode's own permission rules. The Memory tab writes markdown into your
joeru-kit checkout. This is the only part of the app that does either, and it
lives in one service and one route (`/api/joeru`) so the boundary stays legible.

**Always true:**

- Local only — no cloud services, no telemetry, no external uploads
- Nothing leaves your machine except what you type into the Chat tab, which
  goes to whichever model provider you configured in OpenCode
- The database is local SQLite; the API binds to localhost
