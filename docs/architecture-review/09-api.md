# 09 — API

> Every backend endpoint, from [backend/server.js](../../backend/server.js) and [backend/routes/network.js](../../backend/routes/network.js). The server listens on **`http://localhost:3001`** (HTTP) and **`ws://localhost:3001/ws`** (WebSocket) on the same port. CORS is enabled for all origins; JSON body parsing is on.

---

## Endpoint summary

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/metrics` | All metrics in one object |
| GET | `/api/metrics/:type` | One metrics file by name |
| POST | `/api/metrics/:type` | Overwrite one metrics file |
| GET | `/api/claude/info` | Claude directory existence + subdir probe |
| GET | `/api/system/health` | Host CPU/memory/uptime + Claude-dir status |
| GET | `/api/settings` | Read `config.json` (or defaults) |
| POST | `/api/settings` | Write `config.json` |
| GET | `/api/settings/detect-repos` | Auto-detect git repos from Claude sessions |
| GET | `/api/agent-network` | Laid-out React Flow graph + activity (initial paint) |
| POST | `/api/internal/graph-refresh` | Collector → backend "rebuild+broadcast" trigger |
| WS | `/ws` | Push `metrics:update` + `agent-network:update` frames |

---

## GET `/api/metrics`
- **Purpose:** the whole metrics store in one response (used for first paint).
- **Request:** none.
- **Response:** object keyed by metric name; each missing/unreadable file degrades to `{}`.
```json
{ "agents": {...}, "tasks": {...}, "tokens": {...}, "costs": {...},
  "tests": {...}, "git": {...}, "sessions": {...}, "activity": {...} }
```
- **Errors:** `500 { error }` on unexpected failure.

## GET `/api/metrics/:type`
- **Purpose:** a single metrics file (e.g. `/api/metrics/tokens`).
- **Request:** `:type` = file basename without `.json`.
- **Response:** the raw JSON of `metrics/<type>.json`.
- **Errors:** `404 { error: "Metrics not found" }` if the file doesn't exist; `500 { error }`.

## POST `/api/metrics/:type`
- **Purpose:** overwrite a metrics file (used by external writers; the live collector writes files directly, not via this route).
- **Request body:** any JSON object. The server merges in a fresh `lastUpdated`.
```json
{ "...caller fields...": "..." }
```
- **Response:** `{ "success": true, "lastUpdated": "ISO" }`.
- **Errors:** `500 { error }`.
- **Note:** the legacy [collectors/git-collector.js](../../collectors/git-collector.js) posts to `/api/metrics/git` — but that collector is not run in the live setup.

## GET `/api/claude/info`
- **Purpose:** report the Claude directory and a fixed set of subdirectories.
- **Request:** none.
- **Response (exists):**
```json
{ "exists": true, "path": "C:\\Users\\joelr\\.claude", "size": 0, "modified": "ISO",
  "directories": {
    "agents": { "exists": true, "size": 0, "modified": "ISO" },
    "sessions": {...}, "projects": {...}, "history": {...},
    "cache": {...}, "debug": {...}, "daemon": {...}
  } }
```
- **Response (missing):** `{ "exists": false, "path": "..." }`.
- **Errors:** `500 { error }`.

## GET `/api/system/health`
- **Purpose:** point-in-time host health (synchronous `os` stats).
- **Request:** none.
- **Response:**
```json
{ "cpu": { "cores": 8, "model": "..." },
  "memory": { "total": N, "used": N, "free": N, "usagePercent": "63.42" },
  "claude": { "path": "...", "exists": true, "size": N },
  "uptime": 123456, "timestamp": "ISO" }
```
- **Errors:** `500 { error }`.
- **Note:** `claude.size` is the directory-entry size (not recursive).

## GET `/api/settings`
- **Purpose:** read persisted settings from `config.json`.
- **Request:** none.
- **Response:** the contents of `metrics/config.json`, or these **defaults** if absent:
```json
{ "claudeDir": "C:\\Users\\joelr\\.claude", "pollInterval": 30, "monitorClaudeDir": true,
  "repositories": [], "autoRefresh": true, "notifications": false }
```
- **Errors:** `500 { error }`.

## POST `/api/settings`
- **Purpose:** persist settings.
- **Request body:** the full config object (Settings page sends `Config`):
```json
{ "claudeDir": "...", "pollInterval": 5, "monitorClaudeDir": true,
  "repositories": ["d:\\FlowerStorePH\\fs-llm-service"],
  "autoRefresh": true, "notifications": false, "hourlyBudget": 5, "weeklyBudget": 200 }
```
- **Response:** `{ "success": true }` (server adds `lastUpdated` to the stored file).
- **Errors:** `500 { error }`.

## GET `/api/settings/detect-repos`
- **Purpose:** discover git repos from Claude session working directories.
- **Request:** none.
- **Behavior:** reads `.claude/sessions/*.json` cwds; each cwd that is a git repo (or whose immediate subdirs are) is collected; already-configured repos are excluded from `newRepos`.
- **Response:**
```json
{ "detected": ["d:\\FlowerStorePH\\fs-llm-service", "..."],
  "newRepos": ["...only those not already in config..."] }
```
- **Errors:** `500 { error }`.

## GET `/api/agent-network`
- **File:** [backend/routes/network.js](../../backend/routes/network.js).
- **Purpose:** the laid-out React Flow graph + latest activity, for the page's initial paint before the first WS push.
- **Request:** none.
- **Response:**
```json
{ "type": "agent-network:update", "timestamp": "ISO",
  "nodes": [ /* root, agent, repo nodes with positions + data */ ],
  "edges": [ /* root->agent, agent->repo, with {animated, data.working} */ ],
  "activity": [ /* activity.json events */ ] }
```
- **Errors:** never throws — on failure returns an empty-but-valid graph with an `error` field.

## POST `/api/internal/graph-refresh`
- **Purpose:** internal hook. The collector calls this after each poll to trigger a debounced rebuild + broadcast.
- **Request body:** empty `{}`.
- **Response:** `{ "ok": true }`.
- **Side effect:** schedules `scheduleBroadcast()` (300ms debounce).

---

## WebSocket `/ws`

- **Purpose:** push live updates so the UI never polls.
- **On connect:** the server immediately sends the current `agent-network:update` frame **and** the current `metrics:update` frame (instant paint).
- **On collector activity:** after `/api/internal/graph-refresh`, the server (debounced 300ms) rebuilds and broadcasts each frame **only if its content changed** (dedupe via stored `lastPayloadStr` / `lastMetricsStr`).

**Frame types:**

`metrics:update`
```json
{ "type": "metrics:update", "timestamp": "ISO",
  "metrics": { "agents": {...}, "tasks": {...}, ... },
  "health": { "cpu": {...}, "memory": {...}, "claude": {...}, "uptime": N } }
```

`agent-network:update`
```json
{ "type": "agent-network:update", "timestamp": "ISO",
  "nodes": [...], "edges": [...], "activity": [...] }
```

- **Change detection detail:** the graph diff keys on `nodes`, `edges`, and activity's stable fields (`type/title/description/icon`) — ignoring per-poll ids and relative timestamps so identical states never rebroadcast. The metrics diff keys on the `metrics` object only (volatile host health is excluded from the comparison but still sent).
- **Client handling:** the metrics hook reads only `metrics:update`; the graph hook reads only `agent-network:update`.

---

## Cross-cutting notes

- **No authentication / authorization** — the server binds `localhost` and trusts all local callers (consistent with the local-only design).
- **All responses are JSON.** Read endpoints are defensive: missing files degrade to `{}` / empty graph rather than erroring.
- **`initializeMetrics()`** runs at startup and creates any missing `agents/tasks/tokens/costs/tests/git/sessions.json` as `{ lastUpdated, data: [] }` placeholders.
