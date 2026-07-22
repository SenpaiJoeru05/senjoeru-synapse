# 10 — Runtime

> How the system behaves while running: startup, background services, collectors, watchers, scheduling, WebSockets, and metric generation.

---

## Startup sequence

### Development (`npm run dev`)
Root [package.json](../../package.json) uses `concurrently` to launch four processes in parallel:

```
npm run dev
├── dev:frontend  → cd frontend && vite            (serves :5173)
├── dev:backend   → cd backend && nodemon server.js (listens :3001)
├── dev:collector → node collectors/index.js        (starts polling)
└── dev:electron  → wait-on http://localhost:5173 && electron .
```
`wait-on` holds Electron until Vite is serving. `dev:web` is the same minus Electron.

### Production / packaged (Electron)
[electron/main.js](../../electron/main.js) on `app.whenReady()`:
1. If **not** dev (`electron-is-dev`), `startBackend()` — spawns `backend/server.js` as a supervised child (in dev, `concurrently` already runs it).
2. `startCollector()` — always spawns `collectors/index.js` as a supervised child.
3. `createWindow()` — a 1220×780 `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`, preload bridge) that loads `http://localhost:5173` (dev) or `file://frontend/dist/index.html` (prod).

### Process supervision
`spawnSupervised(label, dir, script, assign)` pipes child stdout/stderr to the main process and, on child `exit`, restarts it after **3 seconds**. On `window-all-closed`, both children have their `exit` listeners removed and are killed before the app quits (non-macOS).

### Backend startup
[backend/server.js](../../backend/server.js): `initializeMetrics()` creates any missing metrics files; the Express app + `ws` WebSocket server share one `http.Server` on `:3001`.

### Collector startup
[collectors/index.js](../../collectors/index.js): `fs.ensureDirSync(metrics)`, register `chokidar` watchers, then `startPolling()` runs one immediate `poll()` and sets the interval.

---

## Background services

| Service | Process | What it does |
|---|---|---|
| REST API | backend | Serves metrics/settings/health/graph over HTTP |
| WebSocket broadcaster | backend | Debounced, change-only push of metrics + graph frames |
| Collector poll loop | collector | Periodic + event-driven metric regeneration |
| File watchers | collector | Trigger immediate re-poll on `.claude`/config changes |
| Child-process supervisor | electron | Restart crashed backend/collector |

---

## Collectors

`poll()` runs all six collectors **in parallel** (`Promise.all`), then fires `notifyBackend()`:

| Collector | Reads | Writes | Notes |
|---|---|---|---|
| `collectTokens()` | `.claude/projects/**/*.jsonl` | `tokens.json`, `costs.json` | Dedup by message id; aggregates by day/hour/project; Sonnet-4.6 pricing |
| `collectSessions()` | `.claude/sessions/*.json` | `sessions.json` | pid/cwd/version/kind/startedAt |
| `collectTasks()` | `.claude/tasks.json` (or memory `.md`) | `tasks.json` | Lenient parse + escape repair; memory fallback |
| `collectAgents()` | `.claude/agents/*.md` + sessions | `agents.json` | Working detection via transcript mtime |
| `collectGit()` | configured repos (`simple-git`) | `git.json` | branch/status/ahead-behind/last-5-commits |
| `collectActivity()` | `agents.json`+`tasks.json`+`git.json` | `activity.json` | Synthesized event feed, capped 20 |

If any collector throws, `poll()` catches and logs `[collector] error:` without stopping the loop.

> Not part of the loop: [collectors/git-collector.js](../../collectors/git-collector.js) (separate, unused) and [backend/populate-sample-data.js](../../backend/populate-sample-data.js) (manual seeder).

---

## File watchers

`chokidar` watches (in `collectors/index.js`):
- `C:\Users\joelr\.claude\sessions`
- `C:\Users\joelr\.claude\projects`
- `C:\Users\joelr\.claude\tasks.json`
- `metrics/config.json`

Watcher options: `ignoreInitial: true`, dotfiles ignored, `awaitWriteFinish` (300ms stability). Events:
- **`change`** → log + `poll()`
- **`add`** → log (special-cases `tasks.json` created / new session) + `poll()`
- **`unlink`** → log "session closed" + `poll()` (clears Working status when Claude Code exits)

This makes the dashboard react within a few hundred ms of a real change, independent of the interval.

---

## Scheduler

- **Collector interval:** `startPolling()` reads `config.json.pollInterval` (seconds, min 5) → `intervalMs`, default **15s** if unset/invalid. `setInterval(poll, intervalMs)`. The live `config.json` sets `pollInterval: 5`.
- **Backend `node-cron`:** imported in `server.js` but **no `cron.schedule` call exists** — it is currently unused.
- **Legacy git-collector:** if it were run, it uses its own `setInterval(..., 10000)` — but it is not wired in.

---

## WebSockets

Server side ([backend/server.js](../../backend/server.js)):
- `WebSocketServer({ server, path: '/ws' })` shares the HTTP port.
- **On connection:** sends current graph frame + metrics frame immediately.
- **On `/api/internal/graph-refresh`:** `scheduleBroadcast()` — clears/sets a **300ms** debounce timer, then:
  1. `buildPayload()` (graph + activity), compare against `lastPayloadStr` on stable fields → broadcast if changed.
  2. `buildMetricsPayload()` (metrics + health), compare `metrics` against `lastMetricsStr` → broadcast if changed.
- `broadcast(str)` sends to every open client.

Client side: two hooks each maintain a resilient socket with exponential-backoff reconnect and REST-first paint (see [08-dashboard.md](08-dashboard.md)).

---

## Metrics generation (per cycle, end to end)

```
[interval tick OR chokidar event]
        │
        ▼
   poll()  ──►  Promise.all(6 collectors)  ──►  metrics/*.json rewritten
        │
        ▼
   notifyBackend()  ──►  POST /api/internal/graph-refresh
        │
        ▼
   backend scheduleBroadcast() (300ms debounce)
        │
        ├── graph changed?  ──► broadcast agent-network:update
        └── metrics changed? ──► broadcast metrics:update
        │
        ▼
   frontend hooks apply frames  ──►  React re-render
```

Timing characteristics:
- **Event-driven latency:** ~300ms (chokidar stability) + ~300ms (broadcast debounce) + collect time.
- **Steady-state:** a full poll every 5s (current config).
- **Idle efficiency:** identical payloads are not rebroadcast, so a quiet system produces no WS traffic after the initial frames.

---

## Failure behavior (observed in code)

- Backend down when collector pings → `notifyBackend()` swallows the error; metrics are still written to disk.
- Metrics file missing/corrupt → readers degrade to `{}` / empty graph, never 500 the dashboard.
- `tasks.json` with invalid escapes → repaired in memory (live file untouched); if unrecoverable → memory-derived fallback.
- Child process crash → supervisor restarts after 3s.
- WebSocket drop → client reconnects with backoff; last-known data stays on screen.
