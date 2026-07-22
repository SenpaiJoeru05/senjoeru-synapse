# 01 — Overview

> Objective snapshot of SenJoeru Synapse **as currently implemented**. No redesign, no recommendations.

---

## Project purpose

**SenJoeru Synapse** ("The Neural Network of Your AI Team") is a **local-first desktop application** that monitors and visualizes AI coding agents (primarily Claude Code) running on a single developer workstation.

Its defining design constraint is **zero-token monitoring**: the dashboard never calls an LLM. It only *reads* files that Claude Code and the developer already write to disk (`C:\Users\joelr\.claude\`) and repositories on disk, computes metrics from them, and renders them.

The app is purpose-built around the **FlowerStorePH** engineering setup — a set of specialized Claude agents working across the repos `fs-llm-service`, `fsweb`, `chat-widget`, `cs-dashboard`, and `seller-page`.

Metadata (from [package.json](../../package.json)): `appId: com.senjoeru.synapse`, `productName: SenJoeru Synapse`, author `SenJoeru`, license `MIT`, version `1.0.0`.

---

## High-level architecture

Synapse is a **monorepo of four cooperating Node/JS processes**, all on `localhost`:

```
┌──────────────────────────────────────────────────────────────┐
│                      Electron shell                            │
│  electron/main.js — spawns+supervises collector (and backend   │
│  in production), loads the React UI                            │
└───────────────┬─────────────────────────────┬─────────────────┘
                │                             │
     ┌──────────▼──────────┐        ┌─────────▼───────────┐
     │  React dashboard     │        │  Collector           │
     │  frontend/ (Vite     │        │  collectors/index.js │
     │  :5173 dev)          │        │  (poll + chokidar)   │
     └──────────┬──────────┘        └─────────┬───────────┘
                │ HTTP /api + WS /ws           │ reads (READ-ONLY)
     ┌──────────▼──────────┐                   │
     │  Express backend     │◄──── reads ───────┤
     │  backend/server.js   │                   │
     │  (:3001, HTTP + WS)  │                   ▼
     └──────────┬──────────┘     ┌───────────────────────────────┐
                │ writes/reads    │  C:\Users\joelr\.claude\       │
                ▼                 │   sessions/ projects/ agents/  │
     ┌────────────────────┐  reads│   tasks.json  memory/*.md      │
     │  metrics/*.json     │◄──────┤   projects/**/*.jsonl          │
     │  (local data store) │       └───────────────────────────────┘
     └────────────────────┘        + monitored git repos on disk
```

---

## Major components

| Component | Location | Responsibility |
|---|---|---|
| **Electron shell** | [electron/](../../electron/) | Desktop window; spawns/supervises the collector (and the backend in packaged builds); hardened `contextIsolation` + `preload.js`. |
| **React dashboard** | [frontend/](../../frontend/) | Vite + React + TypeScript SPA. 9 routed pages. Consumes metrics over REST + WebSocket. |
| **Express backend** | [backend/](../../backend/) | REST API + WebSocket server on port 3001. Serves `metrics/*.json`, system health, settings; builds the agent-network graph; broadcasts live updates. |
| **Collector** | [collectors/index.js](../../collectors/index.js) | The data engine. Reads Claude files + git repos, computes metrics, writes `metrics/*.json`, pings the backend to broadcast. |
| **Metrics store** | [metrics/](../../metrics/) | JSON files that are the contract between collector (writer) and backend/UI (readers). |
| **Shared config** | [shared/agent-repos.js](../../shared/agent-repos.js) | Single source of truth for the repo↔agent mapping, used by both collector and backend. |

---

## Current technologies

| Layer | Technologies (from package.json files) |
|---|---|
| Desktop | Electron 28, `electron-builder`, `electron-is-dev` |
| Frontend | React 18, TypeScript 5, Vite 5, TailwindCSS 3, Framer Motion, Recharts, `@xyflow/react` (React Flow 12), Lucide React, React Router 6, Axios, clsx, tailwind-merge, date-fns |
| Backend | Node.js, Express 4, `ws`, `cors`, `fs-extra`, `chokidar`, `node-cron` |
| Collector | Node.js, `chokidar`, `simple-git`, `fs-extra`, `axios` |
| Dev tooling | `concurrently`, `wait-on`, `nodemon` |

Full detail: see [11-dependencies.md](11-dependencies.md).

---

## Folder structure (top level)

```
senjoeru-synapse/
├── electron/          # Electron main process + preload bridge + supervisor
├── frontend/          # React + Vite dashboard (src/pages, src/components, src/lib)
├── backend/           # Express REST + WS server, graph-builder lib, sample seeder
├── collectors/        # Data collectors (index.js is live; git-collector.js is separate)
├── shared/            # agent-repos.js (repo↔agent map, shared by backend + collector)
├── metrics/           # Local JSON data store (agents/tasks/tokens/costs/tests/git/sessions/activity/config)
├── docs/              # SENJOERU_SYNAPSE_SPEC.md, PROJECT_DESCRIPTION, this review
├── dist/              # Packaged desktop build output
├── logo.svg
├── package.json       # root — orchestration scripts + electron-builder config
├── README.md
└── PROJECT_DESCRIPTION.md
```

Detailed per-folder breakdown: [02-project-structure.md](02-project-structure.md).

---

## Runtime flow

1. **Startup** — `npm run dev` uses `concurrently` to start frontend (Vite :5173), backend (:3001), collector, and Electron (via `wait-on`). In a packaged build, `electron/main.js` spawns the backend and collector itself.
2. **Collection** — the collector runs `poll()` immediately, then on an interval (default 15s, config-driven, min 5s), and also on any `chokidar` file-change event under `.claude/sessions`, `.claude/projects`, `tasks.json`, and `metrics/config.json`.
3. **Compute + write** — each poll runs six collectors (tokens, sessions, tasks, agents, git, activity) that write `metrics/*.json`.
4. **Notify** — after writing, the collector POSTs `http://localhost:3001/api/internal/graph-refresh` (fire-and-forget).
5. **Broadcast** — the backend debounces (300ms), rebuilds the agent-network graph + a full metrics snapshot, and broadcasts both over WebSocket `/ws` — but only when the payload actually changed.
6. **Render** — the React app opens the WebSocket (plus one REST fetch for first paint), receives `metrics:update` and `agent-network:update` frames, and re-renders. No client-side polling.

Full runtime detail: [10-runtime.md](10-runtime.md).

---

## How everything works together (one paragraph)

The **collector** passively reads Claude's local files and monitored git repos → computes tokens/costs/tasks/agents/git/activity → writes them to `metrics/*.json` → pings the **backend** → the **backend** serves that data over REST and pushes change-only frames over WebSocket → the **React dashboard**, hosted inside the **Electron** window, renders it live. Because the UI only reads pre-computed JSON and the collector only reads (never calls an LLM), monitoring cost is effectively zero.

---

## Note on documentation scope

Several files in the repo are **present but not wired into the live runtime** (e.g. [collectors/git-collector.js](../../collectors/git-collector.js), [backend/populate-sample-data.js](../../backend/populate-sample-data.js), [metrics/agent-network.json](../../metrics/agent-network.json)). These are documented where relevant and flagged in [12-known-issues.md](12-known-issues.md). This document describes the system as the code currently is, not as the README/PROJECT_DESCRIPTION aspirationally describe it (e.g. those docs still describe polling; the code has since moved to WebSocket push).
