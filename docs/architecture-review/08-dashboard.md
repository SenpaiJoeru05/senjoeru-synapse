# 08 — Dashboard

> The React frontend: architecture, pages, data flow, and state. Source under [frontend/src/](../../frontend/src/).

---

## Dashboard architecture

- **Stack:** React 18 + TypeScript + Vite, styled with TailwindCSS, animated with Framer Motion, charts via Recharts, the network graph via `@xyflow/react` (React Flow 12), icons from Lucide.
- **Entry:** [main.tsx](../../frontend/src/main.tsx) mounts `<App/>` in React StrictMode.
- **Shell:** [App.tsx](../../frontend/src/App.tsx) wraps everything in `RealtimeProvider` (shared WebSocket) and a `BrowserRouter` with a `Layout` route containing 9 child routes.
- **Layout:** [Layout.tsx](../../frontend/src/components/Layout.tsx) renders a fixed 200px sidebar (logo + 9 nav links + version footer) and an `<Outlet/>` for the active page.
- **Hosting:** served by Vite on `:5173` in dev; loaded from `frontend/dist/index.html` (via `file://`) inside Electron in production.
- **Design language:** dark theme (`#0a0a0f` background), glassmorphism ("glass-card"), blue/purple/cyan gradient (`gradient-primary`), neon text/glow, rounded cards. Color tokens defined in [tailwind.config.js](../../frontend/tailwind.config.js).

---

## Pages

Routes from [App.tsx](../../frontend/src/App.tsx):

| Route | File | What it shows | Primary data |
|---|---|---|---|
| `/` | [Overview.tsx](../../frontend/src/pages/Overview.tsx) | Greeting, progress donut, stat cards (agents/tasks/tokens/cost), task-progress list, agent-status list, activity feed, token-cost budgets, system health, active sessions | `metrics` (all) + `health` + `settings` |
| `/agents` | [Agents.tsx](../../frontend/src/pages/Agents.tsx) | Agent cards (avatar, status, active repo, assigned tasks, task count) | `metrics.agents`, `metrics.tasks`, `metrics.sessions` |
| `/tasks` | [Tasks.tsx](../../frontend/src/pages/Tasks.tsx) | Task board with status summary, status/repo filters, expandable per-repo detail | `metrics.tasks` |
| `/analytics` | [Analytics.tsx](../../frontend/src/pages/Analytics.tsx) | Token usage (7-day area), session usage (bar), cost trends (area), stat cards | `metrics.tokens`, `metrics.costs` |
| `/git` | [Git.tsx](../../frontend/src/pages/Git.tsx) | Per-repo branch/ahead/behind, changed-file lists, recent commits | `metrics.git` |
| `/testing` | [Testing.tsx](../../frontend/src/pages/Testing.tsx) | Test totals, per-suite pass rate + coverage | `metrics.tests` (static sample) |
| `/activity` | [Activity.tsx](../../frontend/src/pages/Activity.tsx) | Event timeline (agent/task/commit/test/error) | `metrics.activity.events` |
| `/network` | [AgentNetwork.tsx](../../frontend/src/pages/AgentNetwork.tsx) | React Flow graph: FlowerStorePH → agents → repos, with a live activity feed + node inspector | separate WS (`agent-network:update`) |
| `/settings` | [Settings.tsx](../../frontend/src/pages/Settings.tsx) | General toggles, poll interval, Claude dir, monitored repos (+ auto-detect), budget limits, security notice | `GET/POST /api/settings`, `detect-repos` |

---

## API endpoints (consumed by the frontend)

All calls go through [lib/api.ts](../../frontend/src/lib/api.ts) (Axios, base `/api`, proxied by Vite to `:3001`):

| Method | Endpoint | Used by |
|---|---|---|
| GET | `/api/metrics` | `RealtimeProvider` first paint + `refresh()` |
| GET | `/api/metrics/:type` | `getMetric()` (available; individual slice) |
| GET | `/api/claude/info` | `getClaudeInfo()` (available) |
| GET | `/api/system/health` | `RealtimeProvider` first paint + `refresh()` |
| POST | `/api/metrics/:type` | `updateMetric()` (available) |
| GET | `/api/settings` | Settings, Overview |
| POST | `/api/settings` | Settings save |
| GET | `/api/settings/detect-repos` | Settings auto-detect |
| GET | `/api/agent-network` | Agent Network first paint |

Full endpoint reference (server side): [09-api.md](09-api.md).

---

## WebSocket usage

Synapse uses **two independent WebSocket connections**, both to `ws://localhost:3001/ws`:

1. **`RealtimeProvider`** ([lib/realtime.tsx](../../frontend/src/lib/realtime.tsx)) — app-wide. Listens for `metrics:update` frames (all metrics + host health) and ignores graph frames. Consumed by every page except the graph via `useRealtime()` / `useMetric(key)`.
2. **`useAgentNetwork`** ([lib/useAgentNetwork.ts](../../frontend/src/lib/useAgentNetwork.ts)) — only on the Agent Network page. Listens for `agent-network:update` frames (nodes/edges/activity) and ignores metrics frames.

Both:
- do **one REST fetch first** for instant first paint while the socket handshakes,
- **auto-reconnect with exponential backoff** (`BACKOFF_BASE=500ms`, `BACKOFF_MAX=10s`),
- fully clean up listeners/timers on unmount,
- resolve the URL via an optional `window.__SYNAPSE_WS_URL__` override, else default localhost.

The WS URL is **not** proxied through Vite — it connects directly to `:3001` so it behaves identically in dev and in packaged Electron.

---

## Polling

There is **no client-side polling**. The UI is push-based (WebSocket) with a single REST fetch per connection for first paint, plus a manual `refresh()` (used by the "Refresh" buttons on Tasks/Agents). The Overview header text "Auto-refresh: Ns" reads the `pollInterval` setting for display, but the value drives the *collector's* cadence, not any UI timer.

> Historical note: the README/PROJECT_DESCRIPTION still describe polling; the implementation has moved to WebSocket push. The backend also imports `node-cron` but does not schedule anything.

---

## Metrics (as surfaced in the UI)

The `metrics` object delivered to the UI (`readAllMetrics()` server-side) has keys: `agents, tasks, tokens, costs, tests, git, sessions, activity`. Pages read slices via `useMetric('tokens')` etc. `health` (CPU/memory/Claude-dir/uptime) is delivered alongside metrics on the same WS frame and via `/api/system/health`.

Notable UI-side computations:
- **Overview** `buildActivityFeed()` merges real git commits + task-update events, sorted newest-first (16 rows).
- **Tasks** normalizes any status vocabulary to the 5 canonical statuses and computes average progress + status counts.
- **Analytics/Overview** render token/cost series from `tokens.daily` and `tokens.sessions`.

---

## Live updates

- Collector writes metrics → pings backend → backend debounces 300ms → rebuilds graph + metrics snapshot → broadcasts **only if changed** → both hooks receive the frame and update React state → pages re-render.
- The **Agent Network** page additionally: merges server nodes while preserving user-dragged node positions (`mergeNodes`), styles edges by working-state (`decorateEdge` — cyan + animated when working), fits the view once on first graph, and shows a connection badge (Live / Reconnecting…).
- The **activity feed** dedupes by content key `type|title|description` (because collector regenerates ids each poll) and stamps each new item with local arrival time so timestamps are a real clock, capped at 200 items.

---

## Components

| Component | File | Role |
|---|---|---|
| `Layout` | components/Layout.tsx | Sidebar + outlet |
| `StatCard` | components/StatCard.tsx | Metric tile with optional Recharts sparkline |
| `Card` | components/Card.tsx | Generic card wrapper |
| `RootNode` | components/network/RootNode.tsx | Graph hub node (FlowerStorePH, 🌸, pulsing purple) |
| `AgentNode` | components/network/AgentNode.tsx | Graph agent node (cyan glow when working) |
| `RepoNode` | components/network/RepoNode.tsx | Graph repo node |
| `NodeInspector` | components/network/NodeInspector.tsx | Right-side detail panel (root/agent/repo bodies, task list) |
| `ActivityFeed` | components/network/ActivityFeed.tsx | Left-side live event feed with per-item clock |

---

## State management

- **No Redux/Zustand/etc.** State is React Context + hooks.
- **Global realtime state:** `RealtimeContext` provides `{ metrics, health, connected, ready, refresh }`. `useRealtime()` and `useMetric(key)` consume it.
- **Graph state:** `useAgentNetwork()` returns `{ nodes, edges, activity, connected, ready }`; the page then uses React Flow's `useNodesState`/`useEdgesState` for local interaction (drag/select) and merges server updates into it.
- **Page-local state:** filters (Tasks), form config (Settings), expanded rows, selected node — all `useState` within the page.
- **Settings** is fetched per-page via REST (not on the WS) since it changes rarely.

---

## Current limitations (state, not recommendations)

- **Two WebSocket connections per client** (metrics + graph) to the same endpoint.
- **Testing page shows static sample data** — no collector produces real test metrics.
- README/PROJECT_DESCRIPTION describe polling + a different feature set than the shipped WS push implementation.
- Several color/status maps hardcode the 5 FlowerStorePH repo names and specific agent names.
