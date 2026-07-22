# SenJoeru Synapse — Architecture Review

> Objective documentation of the **current** state of SenJoeru Synapse, generated before any architectural changes. This set only inspects and describes the existing implementation — it does not redesign, refactor, or propose improvements.

**Intended audience:** a software architect reviewing the system prior to changes.

## Contents

| # | Document | Covers |
|---|---|---|
| 01 | [01-overview.md](01-overview.md) | Purpose, high-level architecture, components, tech, runtime flow |
| 02 | [02-project-structure.md](02-project-structure.md) | Full folder tree, backend/frontend/collectors/services/utilities |
| 03 | [03-data-storage.md](03-data-storage.md) | Every JSON store — path, purpose, structure, readers/writers, cadence |
| 04 | [04-agents.md](04-agents.md) | The 10 AI agents — definitions, Working detection, memory, limits |
| 05 | [05-task-system.md](05-task-system.md) | Task creation, ingestion, lifecycle, schema, ownership, progress |
| 06 | [06-repositories.md](06-repositories.md) | Supported repos, discovery, metadata, multi-project support |
| 07 | [07-claude-integration.md](07-claude-integration.md) | The `.claude` directory, sessions, memory, hooks, commands, workflow |
| 08 | [08-dashboard.md](08-dashboard.md) | Frontend architecture, pages, WebSocket/polling, components, state |
| 09 | [09-api.md](09-api.md) | Every backend REST + WebSocket endpoint |
| 10 | [10-runtime.md](10-runtime.md) | Startup, background services, collectors, watchers, scheduler, WS |
| 11 | [11-dependencies.md](11-dependencies.md) | Frameworks, libraries, external services, build tools |
| 12 | [12-known-issues.md](12-known-issues.md) | Technical debt, dead code, hardcoded values, bottlenecks (no solutions) |

## Method

Compiled by reading the repository source directly (all of `frontend/`, `backend/`, `collectors/`, `shared/`, `electron/`, `metrics/*.json`, root config) plus the observed layout of the external `C:\Users\joelr\.claude\` directory that the collector reads. Where a fact could not be determined from the codebase, the document says so explicitly.

## Key cross-cutting facts

- **Zero-token monitoring:** the app never calls an LLM; it only reads files Claude Code and git already write.
- **Four processes:** Electron shell, React frontend (`:5173`), Express backend (`:3001`, HTTP+WS), and the collector.
- **Data store:** flat JSON files in `metrics/` — no database.
- **Push-based UI:** WebSocket `agent-network:update` + `metrics:update` frames; the README's "polling" description is out of date.
- **Documentation vs code drift** is noted where present (see 08 and 12).
