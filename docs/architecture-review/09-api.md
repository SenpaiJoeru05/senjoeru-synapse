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
| POST | `/api/agent-events` | Claude Code hook sink — live subagent dispatch events |
| GET | `/api/agent-activity` | Current live dispatches (initial paint) |
| POST | `/api/internal/graph-refresh` | Collector → backend "rebuild+broadcast" trigger |
| WS | `/ws` | Push `metrics:update` + `agent-network:update` + `agent-activity:update` frames |

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

## POST `/api/agent-events`
- **File:** [backend/routes/agent-activity.js](../../backend/routes/agent-activity.js).
- **Purpose:** the sink for Claude Code's subagent hooks — Synapse's **only inbound integration point**. Everything else it knows, it observes from the filesystem.
- **Caller:** `joeru-kit/bin/hook-forward.js`, never a browser.
- **Request body:** the hook's own JSON payload, verbatim (`hook_event_name`, `agent_id`, `agent_type`, `session_id`, `cwd`, `tool_name`, `tool_input`, `tool_use_id`, …).
- **Response:** always `{ "ok": true }`.
- **Errors: none, by design.** Malformed bodies and unknown event names are accepted and dropped. The caller is a fire-and-forget hook that ignores the response, so a 4xx/5xx here would buy nothing and risk noise in a dispatch's critical path.
- **Ignored silently:** events with no `agent_id` — that is the parent thread's own tool calls, which these globally-configured hooks also fire for and which this feature is not about.
- **Side effect:** schedules an `agent-activity:update` broadcast (120ms debounce).

## GET `/api/agent-activity`
- **File:** [backend/routes/agent-activity.js](../../backend/routes/agent-activity.js).
- **Purpose:** current live dispatches, for initial paint before the first WS push.
- **Not to be confused with** `/api/observation/agent-activity`, which is a historical log. The client method is named `getDispatchActivity()` for that reason.
- **Response:**
```json
{ "agents": [ { "agentId": "…", "agentType": "backend-engineer", "repo": "fsweb",
                "status": "working", "startedAt": 0, "lastEventAt": 0,
                "current": { "tool": "Read", "detail": "Reading foo.ts", "icon": "file-text", "status": "running", "at": 0 },
                "recent": [ /* last 5, same shape */ ], "toolCallCount": 0, "lastMessage": null } ] }
```
- **Storage:** in-memory only, never SQLite — this is transient live state, regeneratable and worthless once stale (matches ARCHITECTURE-V2's ownership matrix). Finished entries are swept 60s after they complete.

## POST `/api/internal/graph-refresh`
- **Purpose:** internal hook. The collector calls this after each poll to trigger a debounced rebuild + broadcast.
- **Request body:** empty `{}`.
- **Response:** `{ "ok": true }`.
- **Side effect:** schedules `scheduleBroadcast()` (300ms debounce).

---

## WebSocket `/ws`

- **Purpose:** push live updates so the UI never polls.
- **On connect:** the server immediately sends the current `agent-network:update`, `metrics:update` **and** `agent-activity:update` frames (instant paint).
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

`agent-activity:update`
```json
{ "type": "agent-activity:update", "timestamp": "ISO",
  "agents": [ /* same shape as GET /api/agent-activity */ ] }
```
- Driven by hook arrivals, **not** by the collector's poll, so it has its own 120ms debounce rather than riding the 300ms cycle above. A subagent's tool calls land in bursts; 300ms would make a fast sequence of actions look like one.

- **Change detection detail:** the graph diff keys on `nodes`, `edges`, and activity's stable fields (`type/title/description/icon`) — ignoring per-poll ids and relative timestamps so identical states never rebroadcast. The metrics diff keys on the `metrics` object only (volatile host health is excluded from the comparison but still sent).
- **Client handling:** the metrics hook reads only `metrics:update`; the graph hook reads only `agent-network:update`; `useAgentActivity()` reads only `agent-activity:update`.
- **Two client connection patterns exist.** Most pages share `RealtimeProvider`'s single socket. `useAgentNetwork()` and `useAgentActivity()` each open their own, because the Agent Network page and the Assistant Mode window both render outside/before that provider mounts.

---

## Cross-cutting notes

- **No authentication / authorization** — the server binds `localhost` and trusts all local callers (consistent with the local-only design).
- **All responses are JSON.** Read endpoints are defensive: missing files degrade to `{}` / empty graph rather than erroring.
- **`initializeMetrics()`** runs at startup and creates any missing `agents/tasks/tokens/costs/tests/git/sessions.json` as `{ lastUpdated, data: [] }` placeholders.
