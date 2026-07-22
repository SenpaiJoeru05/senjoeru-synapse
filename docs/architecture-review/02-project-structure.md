# 02 — Project Structure

> Complete folder + file inventory of the repository (excluding `node_modules/`, `dist/`, build output). File paths are relative to the repo root.

---

## Complete folder tree (source files)

```
senjoeru-synapse/
├── .claude/
│   └── settings.local.json          # local Claude Code permission allowlist for THIS repo
├── .gitignore
├── README.md
├── PROJECT_DESCRIPTION.md
├── logo.svg
├── package.json                     # root orchestration + electron-builder config
├── package-lock.json
│
├── electron/
│   ├── main.js                      # Electron main process + child-process supervisor
│   ├── preload.js                   # contextBridge -> window.electronAPI
│   └── package.json                 # dep: electron-is-dev
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts               # @ alias, :5173, /api proxy -> :3001
│   ├── tailwind.config.js           # color tokens, gradients, animations
│   ├── postcss.config.js
│   ├── tsconfig.json / tsconfig.node.json
│   └── src/
│       ├── main.tsx                 # React entry
│       ├── App.tsx                  # Router + RealtimeProvider + 9 routes
│       ├── index.css                # Tailwind + glass/neon utility classes
│       ├── components/
│       │   ├── Layout.tsx           # sidebar nav + <Outlet/>
│       │   ├── Card.tsx
│       │   ├── StatCard.tsx         # metric card with optional Recharts mini-chart
│       │   └── network/
│       │       ├── RootNode.tsx     # React Flow node — FlowerStorePH hub
│       │       ├── AgentNode.tsx    # React Flow node — agent
│       │       ├── RepoNode.tsx     # React Flow node — repo
│       │       ├── NodeInspector.tsx# right-side detail panel
│       │       └── ActivityFeed.tsx # left-side live event feed
│       ├── pages/
│       │   ├── Overview.tsx
│       │   ├── Agents.tsx
│       │   ├── Tasks.tsx
│       │   ├── Analytics.tsx
│       │   ├── Git.tsx
│       │   ├── Testing.tsx
│       │   ├── Activity.tsx
│       │   ├── AgentNetwork.tsx
│       │   └── Settings.tsx
│       └── lib/
│           ├── api.ts               # Axios REST client
│           ├── realtime.tsx         # RealtimeProvider: shared WS for metrics
│           ├── useAgentNetwork.ts   # separate WS hook for the graph page
│           ├── network-types.ts     # TypeScript types for the graph payload
│           └── utils.ts             # cn(), formatBytes/Number/Date/Duration
│
├── backend/
│   ├── server.js                    # Express app + WebSocket server (:3001)
│   ├── package.json
│   ├── populate-sample-data.js      # one-off seeder (NOT wired into runtime)
│   ├── routes/
│   │   └── network.js               # GET /api/agent-network
│   └── lib/
│       ├── graph-builder.js         # metrics JSON -> React Flow graph
│       └── graph-builder.test.js    # node --test unit tests
│
├── collectors/
│   ├── index.js                     # LIVE collector: tokens/sessions/tasks/agents/git/activity
│   ├── git-collector.js             # SEPARATE older git collector (NOT wired into runtime)
│   └── package.json
│
├── shared/
│   └── agent-repos.js               # repo <-> agent single source of truth
│
├── metrics/                         # local JSON data store (git-ignored except .gitkeep)
│   ├── .gitkeep
│   ├── config.json
│   ├── agents.json
│   ├── tasks.json
│   ├── tokens.json
│   ├── costs.json
│   ├── tests.json
│   ├── git.json
│   ├── sessions.json
│   ├── activity.json
│   └── agent-network.json           # legacy sample data (NOT read by the live graph)
│
└── docs/
    ├── SENJOERU_SYNAPSE_SPEC.md
    ├── Claude Team Question.md      # the documentation request that produced this folder
    └── architecture-review/         # <- this documentation set
```

---

## Purpose of every major folder

| Folder | Purpose |
|---|---|
| `.claude/` | Repo-scoped Claude Code settings — a permission allowlist (`settings.local.json`). Not part of the running app. |
| `electron/` | Desktop shell. Owns the window and supervises the Node child processes. |
| `frontend/` | The dashboard SPA. All UI, routing, charts, graph, state. |
| `backend/` | The REST + WebSocket server. The only process the frontend talks to. |
| `collectors/` | The data-gathering engine that turns Claude/git files into metrics JSON. |
| `shared/` | Cross-process constants (repo↔agent map) imported by both backend and collector. |
| `metrics/` | The on-disk data store — the contract between collector (writer) and backend/UI (readers). |
| `docs/` | Product spec + this architecture review. |
| `dist/` | Packaged Electron output (build artifact; not source). |

---

## Important files

| File | Why it matters |
|---|---|
| [package.json](../../package.json) (root) | Defines `dev`, `dev:web`, `build`, `build:electron` scripts and the electron-builder `files` list. `postinstall` installs sub-package deps. |
| [electron/main.js](../../electron/main.js) | `spawnSupervised()` auto-restarts crashed children; decides whether to spawn the backend (production only). |
| [backend/server.js](../../backend/server.js) | All REST routes + the WebSocket broadcast logic + change-detection dedupe. Hardcodes `PORT=3001` and `CLAUDE_DIR`. |
| [backend/lib/graph-builder.js](../../backend/lib/graph-builder.js) | Two-stage (topology, then layout) transform from metrics into a React Flow graph. |
| [collectors/index.js](../../collectors/index.js) | Six collector functions + the `poll()` loop + `chokidar` watchers + interval scheduler. |
| [shared/agent-repos.js](../../shared/agent-repos.js) | `REPO_PRIMARY_AGENTS`, `AGENT_REPOS`, `ALL_REPOS`, `NON_REPO_KEYS`. |
| [frontend/src/lib/realtime.tsx](../../frontend/src/lib/realtime.tsx) | Single app-wide WebSocket for metrics, consumed by all pages via `useRealtime()`. |

---

## Backend structure

```
backend/
├── server.js         # Express app, all /api routes, HTTP+WS server on :3001
├── routes/
│   └── network.js    # GET /api/agent-network (initial graph paint)
└── lib/
    ├── graph-builder.js       # buildGraph() -> layoutGraph() -> buildLaidOutGraph()
    └── graph-builder.test.js  # 15 unit tests (node --test)
```

- `server.js` responsibilities: metrics read/write endpoints, `/api/claude/info`, `/api/system/health`, `/api/settings` (+ save + `detect-repos`), the WebSocket server, the debounced change-only broadcaster, and the `/api/internal/graph-refresh` hook the collector calls.
- `graph-builder.js` is pure/deterministic and dependency-light; it is unit-tested in isolation.

## Frontend structure

- **Entry:** `main.tsx` → `App.tsx` (wraps everything in `RealtimeProvider` and a `BrowserRouter`).
- **Layout:** `components/Layout.tsx` renders the fixed sidebar and an `<Outlet/>` for the active page.
- **Pages:** one file per route under `src/pages/` (9 total).
- **Realtime state:** `lib/realtime.tsx` (metrics for 8 pages) and `lib/useAgentNetwork.ts` (graph for the Agent Network page) each own a WebSocket connection.
- **Graph UI:** `components/network/` holds the React Flow node renderers and side panels.
- **Utilities:** `lib/utils.ts` (formatting + `cn`), `lib/api.ts` (Axios client), `lib/network-types.ts` (types).

## Collectors

- [collectors/index.js](../../collectors/index.js) — the **live** collector. Contains `collectTokens`, `collectSessions`, `collectTasks`, `collectAgents`, `collectGit`, `collectActivity`, the `poll()` orchestrator, `chokidar` watchers, and `startPolling()`.
- [collectors/git-collector.js](../../collectors/git-collector.js) — a **separate, standalone** git collector with an *older* output shape (writes `{ data: [...] }`, POSTs to `/api/metrics/git`). It is **not referenced** by any npm script or by `electron/main.js`. See [12-known-issues.md](12-known-issues.md).

## Metrics

Nine JSON files (plus a legacy `agent-network.json`) form the data store. Each is written by a specific collector and read by specific backend endpoints / UI pages. Full field-by-field breakdown: [03-data-storage.md](03-data-storage.md).

## Services

There is no separate "services" directory. The equivalent runtime services are the four processes (Electron, frontend, backend, collector) plus the two backend "sub-services": the REST API and the WebSocket broadcaster (both in `server.js`).

## Utilities

| Utility | Location | Provides |
|---|---|---|
| Frontend formatters | [frontend/src/lib/utils.ts](../../frontend/src/lib/utils.ts) | `cn`, `formatBytes`, `formatNumber`, `formatDate`, `formatDuration` |
| Graph helpers | [backend/lib/graph-builder.js](../../backend/lib/graph-builder.js) | `slug`, `normalizeRepoNames`, `cwdMatchesRepo`, `compareTasks` |
| Collector helpers | [collectors/index.js](../../collectors/index.js) | `calcCost`, `formatProjectName`, `dayKey/hourKey`, `findJsonlFiles`, `repairInvalidJsonEscapes`, `formatAgentName`, `cwdToProjectDirName`, `getLatestJSONLMtime` |
| Shared constants | [shared/agent-repos.js](../../shared/agent-repos.js) | `REPO_PRIMARY_AGENTS`, `AGENT_REPOS`, `ALL_REPOS`, `NON_REPO_KEYS`, `buildAgentRepos()` |
