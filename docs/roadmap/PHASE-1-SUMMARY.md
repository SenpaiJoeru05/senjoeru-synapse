# Phase 1 — Data Layer Foundation · Summary

**Status:** Implemented (dev) · **Date:** 2026-07-23
**Related:** [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md) · [PHASE-1-Data-Layer.md](PHASE-1-Data-Layer.md)

**The headline:** SenJoeru Synapse went from a *live-monitoring dashboard backed by throwaway JSON files* to a real application **with a permanent database (SQLite)** — while keeping everything that already worked (zero-token monitoring, collectors, WebSocket, the whole dashboard).

---

## What this means (plain version)

| Before | Now |
|---|---|
| Data lived in JSON files that get overwritten | **Permanent SQLite database** — nothing is lost |
| Task notes overwritten each update, history gone | **Every task keeps its full history forever** (append-only) |
| Settings saved to a cache file | **Settings saved permanently** in the database |
| Token/cost analytics only kept **7 days** | **Unbounded history** — kept for all time |
| No record of completed work | **Execution history** — every completed task + git commit |
| Agent Network layout reset when you left the tab | **Your layout is saved** (+ a Reset button) |

---

## New capabilities

- **🗄️ SQLite database** — the permanent "source of truth," with a migration system (3 migrations, 10 tables) that upgrades itself automatically on startup.
- **📋 Task persistence + history** — `.claude/tasks.json` is imported one-way into SQLite. Claude still writes `tasks.json` exactly as before; Synapse reads it and keeps a permanent, **append-only** record of every state each task has ever had.
- **💾 Settings on SQLite** — Save now persists to the database (and mirrors to `config.json` so the collector keeps working unchanged).
- **🏗️ Projects / Repositories / Workspaces** — the relational foundation for organizing work (Workspace → Projects → Repositories).
- **📈 Analytics & history** — daily token/cost history (forever), daily engineering metrics (agents, tasks, repos), and an execution timeline.
- **🕓 New "History" page** in Mission Control — a live execution timeline (task completions + commits) and a searchable Task History Explorer to see any task's full evolution.
- **⚡ Live from the database** — a new `db:update` WebSocket frame pushes SQLite data to the dashboard in real time. The Tasks, Overview, and Agents pages now read from SQLite (Step 10).
- **🎛️ UI improvements** — Agent Network layout persists across tabs/restarts with a Reset button; History uses an in-theme searchable list instead of a raw dropdown.

---

## Under the hood

- **Clean architecture** as ARCHITECTURE-V2 requires: Routes → **Services** (business rules) → **Repositories** (all SQL) → SQLite. Collectors stay observers; the sync service is the only thing that writes tasks; SQLite is authoritative, JSON is cache.
- **New API endpoints:** `/api/tasks`, `/api/tasks/:id/history`, `/api/projects`, `/api/repositories`, `/api/workspaces`, `/api/analytics/tokens`, `/api/analytics/costs`, `/api/analytics/metrics`, `/api/execution-history`.
- **Tables:** `tasks`, `task_history`, `workspaces`, `projects`, `repositories`, `settings`, `token_history`, `cost_history`, `analytics`, `execution_history` (+ `schema_migrations`).

### New / changed files

| Area | Files |
|---|---|
| Database | `backend/lib/db.js` (open + migrations) |
| Repositories (SQL) | `backend/repositories/{task,workspace,project,repository,settings,analytics}-repository.js` |
| Services (business rules) | `backend/services/{task-sync,workspace,project,repository,settings,analytics}-service.js` |
| Routes | `backend/routes/{tasks,core-entities,analytics}.js` |
| Shared | `shared/tasks-board.js` (lenient reader/normalizer for `.claude/tasks.json`) |
| Server wiring | `backend/server.js` (DB init, sync on poll, `db:update` WS frame, endpoints) |
| Frontend | `frontend/src/pages/History.tsx`, `lib/realtime.tsx` (`db` state + `useTasks()`), `lib/api.ts`, `pages/{Tasks,Overview,Agents,AgentNetwork}.tsx`, `components/Layout.tsx`, `App.tsx` |
| Tests | `backend/services/{task-sync,core-entities,analytics}-service.test.js` |

---

## Task ownership model (resolved decision)

```
Claude agents ──write──> .claude/tasks.json ──read──> Sync Service ──write──> SQLite ──> UI
  (author)                (Claude's inbox)            (import/upsert)      (permanent,
                                                                            append-only history)
```

- Claude only ever touches `tasks.json` (unchanged from the global `CLAUDE.md` rule).
- `.claude/tasks.json` is an external input owned by Claude; Synapse **reads only**, never writes it.
- SQLite is the permanent store; writes flow one direction only → no dual ownership.
- History model = **Option A (append-only)**: every distinct state is kept forever.

---

## Quality / safety

- ✅ **35 backend tests pass**; frontend **type-checks clean** (strict mode + `noUnusedLocals`).
- ✅ **Zero regression** — everything additive; SQLite features fall back gracefully if the DB is unavailable.
- ✅ Verified live against **real data** (44+ tasks imported, 7 days of tokens, 25+ execution events, idempotent re-syncs).
- ✅ Migration Steps 1–10 from the plan: **all done**.

---

## The one thing left

**Packaging (`electron-rebuild`)** — needed only when building a distributable `.exe`, because `better-sqlite3` is a native module that must be rebuilt for Electron's ABI. **`npm run dev` works fully today.** Deferred deliberately until a real build is produced so it can be verified rather than configured blind.

---

## Bottom line

The core Phase-1 objective is achieved: **SQLite is now the permanent brain of Synapse**, work is preserved with full history, and it's all visible live in the dashboard. Next options: **Phase 2** (orchestration/analytics on top of this foundation) or the **packaging** finish.
