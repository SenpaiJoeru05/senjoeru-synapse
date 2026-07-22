# 03 — Data Storage

> Every place Synapse stores data. All storage is **flat JSON files on the local disk** — there is no database. Structures below are taken from the live files in [metrics/](../../metrics/) and the code that writes them.

---

## Storage locations at a glance

| Location | Kind | Owner |
|---|---|---|
| `metrics/*.json` | Runtime data store (9 live files + 1 legacy) | Collector writes; backend/UI read |
| `metrics/config.json` | Configuration / settings | Backend writes (Settings page); collector + backend read |
| `C:\Users\joelr\.claude\` | **External source** (read-only input) | Claude Code writes; collector reads |
| `metrics/.gitkeep` | Keeps the git-ignored `metrics/` dir tracked | — |

`metrics/*.json` is **git-ignored** (`.gitignore` line `metrics/*.json` with `!metrics/.gitkeep`), so the data store is machine-local and never committed.

Common convention: every metrics file carries a top-level `lastUpdated` ISO timestamp, rewritten on each collector cycle. The backend rewrites files atomically via `fs.writeJson(..., { spaces: 2 })`.

---

## `metrics/config.json` — Settings / configuration

- **Path:** [metrics/config.json](../../metrics/config.json)
- **Purpose:** persisted user settings (Claude dir, poll interval, monitored repos, budgets, toggles).
- **Written by:** `POST /api/settings` (backend, from the Settings page).
- **Read by:** `GET /api/settings` (backend); the collector reads `pollInterval` (poll cadence) and `repositories` (git repo list).
- **Change frequency:** rare — only when the user saves settings.

**Structure / example:**
```json
{
  "claudeDir": "C:\\Users\\joelr\\.claude",
  "pollInterval": 5,
  "monitorClaudeDir": true,
  "repositories": ["d:\\FlowerStorePH\\fs-llm-service", "d:\\FlowerStorePH\\cs-dashboard", "d:\\FlowerStorePH\\chat-widget"],
  "autoRefresh": true,
  "notifications": false,
  "hourlyBudget": 5,
  "weeklyBudget": 200,
  "lastUpdated": "2026-06-29T03:54:38.431Z"
}
```
> Note: `hourlyBudget`/`weeklyBudget` are read by the Overview/Settings UI. The Settings default object in code uses `weeklyBudget: 50`; the live file has `200`.

---

## `metrics/agents.json` — Agents

- **Path:** [metrics/agents.json](../../metrics/agents.json)
- **Purpose:** every agent defined in `.claude/agents/*.md`, with a live Working/Idle status.
- **Written by:** `collectAgents()` in [collectors/index.js](../../collectors/index.js).
- **Read by:** `GET /api/metrics` (all pages via WS), the graph-builder (`buildGraph`), and `collectActivity()`.
- **Change frequency:** every poll (~5–15s) and on any session/project file change.

**Structure:**
```json
{
  "lastUpdated": "ISO",
  "agents": [
    {
      "id": "1",
      "name": "AI Chatbot Engineer",
      "status": "Idle",                // "Working" | "Idle"
      "currentTask": "Builds and tunes ...",  // truncated agent .md description
      "progress": 0,                   // always 0 (not computed)
      "runtime": 0,                    // always 0 (not computed)
      "lastUpdate": "11m ago",         // relative time of last real activity, or "No recent activity"
      "assignedProject": "FlowerStorePH", // "FlowerStorePH" | "General"
      "activeCwd": null                // cwd the agent is working in, when Working
    }
  ],
  "active": 0,                         // count of Working agents
  "total": 10,
  "activeSessions": 4,                 // count of open Claude sessions (any cwd)
  "sessionSummary": "senjoeru-synapse, FlowerStorePH, ..."  // basenames of session cwds
}
```
> `status` is derived from whether the agent's repo has a `.jsonl` file written in the last 10 minutes (see [04-agents.md](04-agents.md)). `progress` and `runtime` are always `0`.

---

## `metrics/tasks.json` — Task board

- **Path:** [metrics/tasks.json](../../metrics/tasks.json)
- **Purpose:** the task board shown on the Tasks/Overview/Agents pages and used to attach tasks to agent nodes.
- **Written by:** `collectTasks()` — copies from `C:\Users\joelr\.claude\tasks.json` (primary) or derives from memory `.md` files (fallback).
- **Read by:** `GET /api/metrics`, the graph-builder, `collectActivity()`.
- **Change frequency:** every poll and immediately when `.claude/tasks.json` changes (watched).
- **`source` field:** `"claude-tasks"` (from the live board) or `"memory-files"` (fallback).

**Structure (source = claude-tasks):**
```json
{
  "lastUpdated": "ISO",
  "source": "claude-tasks",
  "tasks": [
    {
      "id": "email-decision-tree-ph",
      "title": "Email AI agent — decision-tree SOP (PH)",
      "assignedAgent": "AI Chatbot Engineer",
      "repos": [
        { "name": "cs-dashboard", "branch": "n/a", "status": "Reviewing", "notes": "..." }
      ],
      "progress": 100,
      "status": "Reviewing",           // Pending|Working|Reviewing|Completed|Failed
      "eta": "v1 doc delivered ...",
      "priority": "High",              // High|Medium|Low
      "notes": "",
      "lastUpdated": "2026-07-21T00:00:00.000Z"
    }
  ]
}
```
> The live board is large (~875 lines, ~100 KB) with long free-text `notes`. Full lifecycle + schema: [05-task-system.md](05-task-system.md).

---

## `metrics/tokens.json` — Token analytics

- **Path:** [metrics/tokens.json](../../metrics/tokens.json)
- **Purpose:** token usage aggregated by day / session / project for the Analytics + Overview pages.
- **Written by:** `collectTokens()` — walks every `.jsonl` under `.claude/projects/`, dedupes by message id, sums `input`/`output`/`cache_read`/`cache_creation`.
- **Read by:** `GET /api/metrics`; Analytics, Overview.
- **Change frequency:** every poll.

**Structure:**
```json
{
  "lastUpdated": "ISO",
  "today": 1653227,
  "weekly": 259025350,
  "trend": -95,                        // % change vs yesterday
  "weeklyTrend": 0,                    // always 0 (not computed)
  "daily": [ { "day": "Fri", "date": "2026-07-16", "tokens": 109723120, "cost": 47.3756 }, ... ],  // last 7 days
  "sessions": [ { "session": "Session 1", "tokens": 225455892, "project": "FlowerStorePH", "date": "2026-06-16" }, ... ],  // top 10 by tokens
  "byProject": [ { "name": "FlowerStorePH", "tokens": 917370713, "cost": 449.1192 }, ... ]
}
```

---

## `metrics/costs.json` — Cost analytics

- **Path:** [metrics/costs.json](../../metrics/costs.json)
- **Purpose:** dollar figures derived from token counts (Overview budgets, Analytics).
- **Written by:** `collectTokens()` (same pass as tokens).
- **Read by:** `GET /api/metrics`; Overview, Analytics.
- **Change frequency:** every poll.
- **Pricing:** hardcoded **Claude Sonnet 4.6** rates in [collectors/index.js](../../collectors/index.js): input $3/M, output $15/M, cache-read $0.30/M, cache-write $3.75/M.

**Structure:**
```json
{
  "lastUpdated": "ISO",
  "today": 1.2484,
  "thisHour": 0.5038,
  "weekly": 124.4789,
  "monthly": 535.26,                   // = weekly * 4.3 (approximation)
  "trend": -95,
  "weeklyTrend": 0
}
```

---

## `metrics/sessions.json` — Active Claude sessions

- **Path:** [metrics/sessions.json](../../metrics/sessions.json)
- **Purpose:** currently-open Claude Code sessions (Overview "Active Sessions").
- **Written by:** `collectSessions()` — reads `.claude/sessions/*.json`.
- **Read by:** `GET /api/metrics`; Overview, Agents.
- **Change frequency:** every poll and on session file add/remove.

**Structure:**
```json
{
  "lastUpdated": "ISO",
  "sessionCount": 4,
  "active": true,
  "claudePath": "C:\\Users\\joelr\\.claude",
  "exists": true,
  "activeSessions": [
    { "pid": 11284, "sessionId": "15e8...", "cwd": "d:\\JOELRAYTON WORKS\\senjoeru-synapse",
      "version": "2.1.186", "kind": "interactive", "startedAt": 1784761423861 }
  ]
}
```

---

## `metrics/git.json` — Git status

- **Path:** [metrics/git.json](../../metrics/git.json)
- **Purpose:** branch, ahead/behind, changed files, and last 5 commits per monitored repo (Git page + Overview activity).
- **Written by:** `collectGit()` in [collectors/index.js](../../collectors/index.js) via `simple-git`.
- **Read by:** `GET /api/metrics`; Git, Overview, `collectActivity()`.
- **Repo list source:** `config.json.repositories` if present, else a hardcoded `GIT_REPOS` fallback.
- **Change frequency:** every poll.

**Structure (per repo):**
```json
{
  "lastUpdated": "ISO",
  "repos": [
    {
      "path": "d:\\FlowerStorePH\\fs-llm-service",
      "name": "fs-llm-service",
      "branch": "dev", "current": "dev", "tracking": "origin/dev",
      "files": [ { "path": "CLAUDE.md", "index": "A", "working_dir": " " } ],
      "staged": [...], "modified": [...], "created": [...], "deleted": [...],
      "commits": [ { "hash": "b505144", "message": "...", "author": "Joel Rayton", "date": "ISO" } ],
      "ahead": 0, "behind": 0
    }
  ]
}
```
> The live collector's shape uses `repos` + `commits` with `{hash,message,author,date}`. The **orphaned** [collectors/git-collector.js](../../collectors/git-collector.js) writes a *different* shape (`data` instead of `repos`, raw `log.all`) — it is not run (see [12-known-issues.md](12-known-issues.md)).

---

## `metrics/activity.json` — Activity feed

- **Path:** [metrics/activity.json](../../metrics/activity.json)
- **Purpose:** synthesized event feed (Activity page + Agent Network feed).
- **Written by:** `collectActivity()` — derives events from agents/tasks/git data already collected.
- **Read by:** `GET /api/metrics`; Activity page; the backend graph broadcast bundles it into the `agent-network:update` frame.
- **Change frequency:** every poll (regenerated fresh — event `id`s change each cycle).

**Structure:**
```json
{
  "lastUpdated": "ISO",
  "events": [
    { "id": "commit-fs-llm-service-b505144", "type": "commit",
      "title": "New commit in fs-llm-service", "description": "Merge pull request #439 ...",
      "timestamp": "2026-07-21T06:59:55+08:00", "icon": "GitCommit" }
  ]
}
```
> `type` ∈ agent|task|commit; `icon` ∈ Bot|ListTodo|CheckCircle|GitCommit|FileText. Capped at 20 events. Because ids regenerate each poll, clients dedupe on a content key `type|title|description` (see [08-dashboard.md](08-dashboard.md)).

---

## `metrics/tests.json` — Test results (STATIC SAMPLE)

- **Path:** [metrics/tests.json](../../metrics/tests.json)
- **Purpose:** feeds the Testing page (total/passed/failed/coverage per suite).
- **Written by:** **nothing in the live runtime.** No collector produces test data. The current file content is sample data (matching `populate-sample-data.js`), last updated `2026-06-29`.
- **Read by:** `GET /api/metrics`; Testing page.
- **Change frequency:** never (static).

**Structure:**
```json
{
  "lastUpdated": "2026-06-29T01:52:11.348Z",
  "suites": [ { "name": "Unit Tests", "passed": 145, "failed": 3, "total": 148, "coverage": 92, "lastRun": "5 min ago", "duration": 45 } ],
  "passRate": 95.5, "totalTests": 330, "totalPassed": 324, "totalFailed": 6
}
```
> The Testing page reads `metrics.tests.suites`; since nothing writes real data, it displays this seed indefinitely. Flagged in [12-known-issues.md](12-known-issues.md).

---

## `metrics/agent-network.json` — LEGACY (not used by live graph)

- **Path:** [metrics/agent-network.json](../../metrics/agent-network.json)
- **Purpose (historical):** an older agent-graph representation (`agents` with `x/y/connections/messageCount`).
- **Written by:** [backend/populate-sample-data.js](../../backend/populate-sample-data.js) (a one-off seeder, not wired into runtime).
- **Read by:** **nothing** — the live Agent Network graph is built by [backend/lib/graph-builder.js](../../backend/lib/graph-builder.js) from `agents.json` + `tasks.json`, not from this file.
- **Change frequency:** never in normal operation.

---

## Initialization / runtime files

- On backend startup, `initializeMetrics()` in [backend/server.js](../../backend/server.js) creates any missing file among `agents/tasks/tokens/costs/tests/git/sessions.json` with `{ lastUpdated, data: [] }`. (Note: this init shape `{ data: [] }` differs from the richer shapes the collector later writes; it is only a placeholder to avoid 404s before the first collect.)
- The collector calls `fs.ensureDirSync(METRICS_DIR)` on startup.

## Cache files

- **In-app caches:** none on disk. The backend keeps two in-memory dedupe strings (`lastPayloadStr`, `lastMetricsStr`) to avoid rebroadcasting unchanged frames — these are process memory, not files.
- **External caches (read-only inputs, not owned by Synapse):** `C:\Users\joelr\.claude\cache\`, `paste-cache\`, etc., exist under the Claude directory but Synapse does not read them for metrics.

## Configuration files (source-controlled)

| File | Purpose |
|---|---|
| `package.json` (root + electron/frontend/backend/collectors) | deps + scripts + electron-builder config |
| `frontend/vite.config.ts` | dev server port, `/api` proxy, `@` alias |
| `frontend/tailwind.config.js`, `postcss.config.js` | styling |
| `frontend/tsconfig.json`, `tsconfig.node.json` | TypeScript config |
| `.claude/settings.local.json` | Claude Code permission allowlist for this repo |
| `.gitignore` | ignores `node_modules`, `dist`, `.env`, `metrics/*.json` |
