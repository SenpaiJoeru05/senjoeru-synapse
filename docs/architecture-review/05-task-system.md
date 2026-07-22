# 05 — Task System

> How tasks flow from Claude agents into the Synapse dashboard. Synapse is a **read-through mirror** of an external task board — it does not create or own tasks itself.

---

## Source of truth

The authoritative task board is **`C:\Users\joelr\.claude\tasks.json`** — a single JSON file that Claude Code agents update directly (per the global `CLAUDE.md` rule "keep tasks.json up to date"). Synapse *ingests* this file; it never writes back to it.

There is also a backup `tasks.json.bak` in the same directory (written by Claude Code tooling, not by Synapse).

---

## How tasks are created

Tasks are **not created inside Synapse.** There is no "create task" UI or endpoint. Tasks come into existence one of two ways:

1. **Primary — the live board.** A Claude agent edits `C:\Users\joelr\.claude\tasks.json`, adding/updating an entry per the schema below. This is the normal path.
2. **Fallback — derived from memory.** If `tasks.json` is missing or unrecoverable, `collectTasks()` scans `.claude/projects/*/memory/*.md`, parses frontmatter (`name`, `description`), and *synthesizes* tasks — inferring `status`/`progress`/`priority` heuristically from the body text. These are marked `source: "memory-files"` and are explicitly labeled non-authoritative in the collector logs.

---

## How tasks are updated (ingestion pipeline)

`collectTasks()` in [collectors/index.js](../../collectors/index.js):

1. Check if `C:\Users\joelr\.claude\tasks.json` exists.
2. Read it **leniently** via `readTasksBoardLenient()` — plain `JSON.parse` first; on failure, `repairInvalidJsonEscapes()` strips invalid backslash escapes (agents sometimes paste code like `\$queue` into notes) and retries in memory. The live file is **never modified**.
3. Normalize each task into the canonical shape (filling defaults: `assignedAgent → "AI Chatbot Engineer"`, `status → "Pending"`, `priority → "Medium"`, `eta → "TBD"`, etc.).
4. Write `metrics/tasks.json` with `source: "claude-tasks"` and a fresh `lastUpdated`.
5. If the board is unrecoverable, log a warning and fall back to memory-derived tasks.

The collector runs this on every poll **and** immediately when `chokidar` detects a change to `tasks.json` (it is a watched path), so board edits appear in the dashboard within ~300ms + poll debounce.

---

## Current task lifecycle

```
   (agent edits .claude/tasks.json)
              │
              ▼
   chokidar 'change' on tasks.json ──► poll() ──► collectTasks()
              │                                        │
              │                                 readTasksBoardLenient
              │                                 (repair escapes if needed)
              ▼                                        ▼
       metrics/tasks.json  ◄──────────── normalized tasks
              │
              ├──► backend GET /api/metrics + WS metrics:update ──► Tasks/Overview/Agents pages
              └──► graph-builder buildGraph() ──► tasks attached to agent nodes (inspector)
```

**Status vocabulary (canonical):** `Pending | Working | Reviewing | Completed | Failed`.

- The collector's memory-fallback derives status heuristically (`deriveTaskStatus`): text containing "failed/error/blocked" → Failed; "aligned/implemented/committed/completed/done" → Completed; otherwise → Working.
- The frontend defensively **aliases** other vocabularies onto the five canonical statuses (`normalizeStatus` in [Tasks.tsx](../../frontend/src/pages/Tasks.tsx)): e.g. "in progress"/"ongoing" → Working, "done"/"complete" → Completed, "todo" → Pending, "blocked" → Failed.

---

## Current task JSON structure

Per-task shape as normalized into `metrics/tasks.json` (and as authored in `.claude/tasks.json`):

```json
{
  "id": "kebab-case-id",
  "title": "Short human-readable title",
  "assignedAgent": "AI Chatbot Engineer",
  "status": "Working",                       // Pending|Working|Reviewing|Completed|Failed
  "progress": 60,                            // 0-100
  "priority": "High",                        // High|Medium|Low
  "eta": "Pending fsweb gate",
  "notes": "",
  "lastUpdated": "2026-06-29T12:00:00.000Z",
  "repos": [
    {
      "name": "fs-llm-service",              // one of the 5 known repos
      "branch": "feat/my-branch",
      "status": "Working",                   // per-repo status (same vocabulary)
      "notes": "One sentence on current state or blocker."
    }
  ]
}
```

Notes on the live data:
- `repos` may be an **array of objects** (current schema) or, for older/hand-authored entries, an **array of strings**. The graph-builder's `normalizeRepoNames()` handles both.
- `notes` inside a repo entry can be very long free-text (the live board stores detailed engineering logs there).
- The top-level file wraps tasks: `{ lastUpdated, source, tasks: [...] }`.

Full schema example is also documented in the project memory file `task-schema.md`.

---

## Task ownership

- **Ownership = `assignedAgent`** (a display name string, e.g. "Backend Engineer").
- The graph-builder groups tasks under agents by a **normalized slug** of `assignedAgent` (`slug()`), so casing/spacing variants ("ai-chatbot-engineer", "AI Chatbot Engineer", "Ai  Chatbot Engineer") all attach to the same node. This was a fixed regression (see `graph-builder.test.js`).
- A task whose `assignedAgent` matches no known agent is silently dropped from the graph (still shown on the Tasks page).

---

## Agent assignment

Assignment is **manual/authored**, not computed: whoever edits `tasks.json` sets `assignedAgent`. There is no auto-router. The known agent names that assignment targets are the 10 documented in [04-agents.md](04-agents.md).

Per-repo work within a multi-repo task is tracked in the `repos[]` array — each repo carries its own `branch`, `status`, and `notes`, letting one task span `fs-llm-service` + `cs-dashboard` + `chat-widget` with independent per-repo progress.

---

## Progress tracking

- **Task progress:** the `progress` integer (0–100), authored by the agent. The Tasks page also computes an *average progress* across all tasks, and the Overview donut buckets tasks into Completed / In Progress / Pending counts.
- **Ordering:** the Tasks page and graph inspector sort **active first** — `Working → Reviewing → (Testing) → Pending → Completed → Failed`, then by most-recent `lastUpdated` (`compareTasks` in graph-builder; `STATUS_ORDER` in Tasks.tsx).
- **Overview task feed:** `buildActivityFeed()` turns task `lastUpdated` changes into feed rows alongside real git commits.

---

## Current limitations (state, not recommendations)

- **Read-only mirror** — no way to create/edit/complete a task from the dashboard; all writes happen in `.claude/tasks.json` by agents.
- **Heuristic fallback** — memory-derived tasks (`source: "memory-files"`) have guessed status/progress and assign everything to "Claude Agent".
- **No history** — only the current board state is stored; there is no task audit trail or completed-task archive.
- **`progress` is self-reported** by the authoring agent, not verified.
- The live board is a large single file (~100 KB); it is re-read and re-serialized on every poll.
