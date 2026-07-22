# SenJoeru Synapse — Full Project Description

> **"The Neural Network of Your AI Team"**
> A desktop AI Agent Operations Center for monitoring, visualizing, and coordinating AI coding agents on a local developer workstation.

---

## 1. What Is This Project?

**SenJoeru Synapse** is a **local-first desktop application** that acts as a *Mission Control / Operations Center* for AI coding agents. When you run tools like **Claude Code** (and, in future, Devin and other agents) on your machine, they generate a trail of activity — sessions, token usage, task updates, git commits, and memory files. Synapse reads all of that data **passively from local files** and turns it into a live, animated dashboard.

The central design idea is **zero-token monitoring**: the dashboard *never* asks an LLM for status. It only reads the JSON and log files that agents already write to disk. This means you can watch your entire AI engineering workflow in real time **without spending a single additional API token or dollar**.

It is purpose-built around Joel's **FlowerStorePH** engineering setup, where multiple specialized Claude agents (chatbot engineer, backend, frontend, QA, etc.) work across several repos (`fs-llm-service`, `fsweb`, `chat-widget`, `cs-dashboard`, `seller-page`).

### Who it's for
- A developer running one or more AI coding agents locally who wants a single pane of glass to see **what the agents are doing, how much they cost, and whether work is progressing** — without babysitting terminal windows.

---

## 2. How It Works (Architecture)

Synapse is a **monorepo of four cooperating processes**, all running on `localhost`:

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Shell                            │
│  (spawns & supervises the collector, hosts the React UI)      │
└───────────────┬───────────────────────────┬──────────────────┘
                │                            │
      ┌─────────▼─────────┐        ┌─────────▼──────────┐
      │  React Dashboard   │        │  Collector (poll +  │
      │  (Vite, port 5173) │        │  file watchers)     │
      └─────────┬─────────┘        └─────────┬──────────┘
                │ HTTP /api                   │ reads (READ-ONLY)
      ┌─────────▼─────────┐                   │
      │  Express Backend   │◄──── reads ──────┤
      │  (port 3001)       │                   │
      └─────────┬─────────┘                   ▼
                │              ┌────────────────────────────────┐
                ▼              │  C:\Users\joelr\.claude\         │
      ┌───────────────────┐   │   sessions/  projects/  agents/  │
      │  metrics/*.json    │◄──│   tasks.json  memory/*.md        │
      │  (local data store)│   └────────────────────────────────┘
      └───────────────────┘
```

### The four processes

| Process | Folder | Role |
|---|---|---|
| **Electron shell** | `electron/` | The desktop window. On launch it spawns the collector as a child process (auto-restarts it if it crashes) and loads the React app. Uses `contextIsolation` + a `preload.js` bridge for safety. |
| **React dashboard** | `frontend/` | The UI. A Vite + React + TypeScript SPA served on port `5173` in dev, or from `frontend/dist` in production. Polls the backend for metrics and renders them. |
| **Express backend** | `backend/` | A small REST API on port `3001`. Serves the contents of `metrics/*.json`, reports system health, exposes settings, and can auto-detect git repos from Claude sessions. |
| **Collectors** | `collectors/` | The data engine. Reads Claude's local files, computes metrics, and writes them to `metrics/*.json`. Runs on a polling interval **and** reacts instantly to file changes via `chokidar` watchers. |

### The data flow, in one sentence
The **collector** watches Claude's `.claude` directory → computes tokens/costs/tasks/agents/git/activity → writes `metrics/*.json` → the **Express backend** serves those files over HTTP → the **React dashboard** polls and renders them → all inside the **Electron** window.

Because the dashboard only reads pre-computed JSON, the UI stays fast and the LLM cost of monitoring is effectively **zero**.

---

## 3. Core Features

### Data Collection (the engine)
- **Token analytics from real Claude logs** — walks every `*.jsonl` conversation file under `.claude/projects/`, sums `input`, `output`, `cache_read`, and `cache_creation` tokens, and **deduplicates by message ID** so streamed response chunks aren't double-counted. Aggregates by day, by hour, and by project.
- **Cost calculation** — applies Claude Sonnet 4.6 per-token pricing to produce today / this-hour / weekly / projected-monthly cost figures.
- **Live agent status** — reads agent definitions from `.claude/agents/*.md` and marks an agent **"Working"** vs **"Idle"** by checking whether its repo's conversation log was written to in the last 10 minutes (mtime-based activity detection), mapping repos to their primary agents.
- **Session tracking** — reads `.claude/sessions/*.json` to count and describe active Claude Code sessions (PID, cwd, version, start time).
- **Task board ingestion** — reads the live `C:\Users\joelr\.claude\tasks.json` board (the same file agents update), with a fallback that *derives* tasks from Claude memory `.md` files by parsing frontmatter and inferring status/progress from the text.
- **Git monitoring** — uses `simple-git` to read branch, ahead/behind, staged/modified/created/deleted files, and the last 5 commits for each configured repo.
- **Activity timeline** — synthesizes a feed of recent events (agents working, tasks progressing/completed, new commits, files modified) from the other collected data.

### Real-time updates
- **File watchers** (`chokidar`) on `sessions/`, `projects/`, `tasks.json`, and `config.json` trigger an immediate re-poll on any change — including detecting when a session file is *deleted* (Claude Code exited) so "Working" status clears instantly.
- **Interval polling** as a backstop (default every 15s, configurable via settings, minimum 5s).

### Dashboard UI (9 pages)
Routed via React Router inside the Electron window:

1. **Overview** — headline cards: active agents, running tasks, tokens used, tests passing, current session, system health.
2. **Agents** — every agent with status, current task, assigned project, and last-update time.
3. **Tasks** — the task board with title, assigned agent, progress, status, ETA, priority, and per-repo breakdown.
4. **Analytics** — token & cost charts (daily trends, top sessions, per-project breakdown) via Recharts.
5. **Git** — branch, commit history, and changed-file status per repo.
6. **Testing** — passed/failed tests, coverage, last run (scaffold for test-result ingestion).
7. **Activity** — the live event timeline.
8. **Agent Network** — a visualization of the agent "neural network."
9. **Settings** — Claude directory path, poll interval, monitored repo list (with **auto-detect repos** from session history), auto-refresh, and notification toggles.

### Design language
Dark mode, glassmorphism, blue/purple/cyan gradients, neon status indicators, rounded cards, and smooth Framer Motion animations — inspired by Linear, Vercel, Cursor, and Claude.

---

## 4. Technology Stack

| Layer | Technologies |
|---|---|
| **Desktop** | Electron 28, `electron-builder`, `electron-is-dev` |
| **Frontend** | React, TypeScript, Vite, TailwindCSS, shadcn/ui, Framer Motion, Recharts, Lucide React, React Router, Axios |
| **Backend** | Node.js, Express, CORS, `fs-extra`, `node-cron`, `chokidar` |
| **Collectors** | Node.js, `chokidar` (file watching), `simple-git` (git introspection), `fs-extra` |
| **Dev tooling** | `concurrently` (runs all four processes together), `wait-on` (holds Electron until Vite is ready) |

---

## 5. Project Structure

```
senjoeru-synapse/
├── electron/          # Electron main process, preload bridge, collector supervisor
├── frontend/          # React + Vite dashboard
│   └── src/
│       ├── pages/      # Overview, Agents, Tasks, Analytics, Git, Testing, Activity, AgentNetwork, Settings
│       ├── components/ # Layout, Card, StatCard
│       └── lib/        # api.ts (backend client), utils.ts
├── backend/           # Express REST API + sample-data seeder
├── collectors/        # Token/session/task/agent/git/activity collectors
├── metrics/           # Local JSON data store (agents, tasks, tokens, costs, tests, git, sessions, activity)
├── docs/              # SENJOERU_SYNAPSE_SPEC.md (full product spec)
└── dist/              # Production build output
```

### The metrics store (`metrics/*.json`)
This is the contract between the collector and the UI. Each file holds a `lastUpdated` timestamp plus its payload:
`agents.json`, `tasks.json`, `tokens.json`, `costs.json`, `tests.json`, `git.json`, `sessions.json`, `activity.json`, and a `config.json` for settings.

---

## 6. Getting Started

```bash
# Install dependencies (postinstall also installs frontend/backend/collector deps)
npm install

# Run everything in development (frontend + backend + collector + Electron)
npm run dev

# Run the web stack only, without the Electron window
npm run dev:web

# Build the frontend for production
npm run build

# Package the desktop app
npm run build:electron
```

**Ports:** frontend `5173`, backend `3001`.

---

## 7. Security & Privacy Model

Synapse is deliberately conservative because it reads a sensitive directory:

- **Local only** — no cloud services, no external network calls, no telemetry.
- **Read-only** access to the `.claude` directory — the app must **never** modify Claude's files.
- **No automatic modifications** to any monitored repo or agent.
- **No external uploads** — all data stays on the machine in `metrics/`.
- **Token-consumption policy** — the dashboard never calls an LLM; agents write JSON, the dashboard reads it, keeping monitoring cost near zero.
- Electron is hardened: `nodeIntegration: false`, `contextIsolation: true`, no remote module.

---

## 8. Roadmap / Future Features

Planned enhancements from the spec:
- Deeper Claude integration and **MCP monitoring**
- WebSocket-based real-time updates (replacing polling)
- AI model analytics and **AI performance scoring**
- **Token forecasting**
- Desktop notifications and a **system-tray widget**
- Full multi-project support and an **agent communication graph**

---

## 9. Success Criteria

The application succeeds when the user can — **without consuming any additional LLM tokens** — observe AI agents, monitor projects, track tasks, view progress, watch token and cost analytics, follow git activity, and understand system health, all from a single command center for their AI engineering workflow.

---

*App ID: `com.senjoeru.synapse` · Author: SenJoeru · License: MIT · Version 1.0.0*
