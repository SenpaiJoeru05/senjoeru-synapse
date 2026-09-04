# Workspace Portability — Making Synapse Adaptable to Any Workspace

**Status:** Planned (2026-07-28) · **Goal:** decouple Synapse from the FlowerStore workspace so it works for *any* user, *any* set of repos, *any* Claude agent roster — a prerequisite for open-sourcing it.

> **Guiding principle:** the *code* should contain **zero** business-specific names, paths, or people. Everything workspace-specific lives in **one config**, with sensible **zero-config defaults** so a fresh clone "just works" and gets richer as the user fills the config in.

---

## Why now

Joel works at FlowerStore today (a real job worth tracking), but wants to open-source Synapse so it observes *any* engineer's Claude Code workspace. Right now the FlowerStore specifics are hardcoded, so the app only lights up for FlowerStore and can't even start for another user.

## What's hardcoded today (audit 2026-07-28)

| # | Category | Worst offenders | Impact |
|---|---|---|---|
| 1 | **Absolute paths** | `C:\Users\joelr\.claude` in `collectors/index.js:20`, `backend/server.js:63`, `settings-service.js:14`, `Settings.tsx:33`, `metrics/config.json` | **CRITICAL — app can't run for anyone else** |
| 2 | **Repo names** | `shared/agent-repos.js` (6 repos), `collectors/index.js:663` `GIT_REPOS` (`d:\FlowerStorePH\…`), 4 frontend color maps (`REPO_BADGE`/`REPO_DOT`/`REPO_COLORS`) | HIGH — graph, badges, ownership all assume a fixed repo set |
| 3 | **Agent roster** | `shared/agent-repos.js` role names, `formatAgentName()` acronyms, `ROLE_PALETTE` (Team/Overview), default `'AI Chatbot Engineer'` fallbacks | MEDIUM — palette is extensible but repo↔agent map is fixed |
| 4 | **Pricing/model** | `collectors/index.js:24` `PRICING` (Sonnet 4.6), UI labels in `Settings.tsx:381`, `Overview.tsx:499` | LOW — display + cost math only |
| 5 | **Project name** | `inferProject()` (`'FlowerStorePH'` vs `'General'`), `graph-builder.js` root node `label:'FlowerStorePH'` | MEDIUM |
| 6 | **Locale** | `en-PH` in `Intelligence.tsx:75`, `Tasks.tsx:239,315` | LOW |
| 7 | **Branding** | `🌸` + "AI Engineering Workspace" in `RootNode.tsx`, `FlowerStorePH-` formatting in collector | COSMETIC |

## What already exists we can build on (don't reinvent)

- **`metrics/config.json`** — already the operational config the collector reads each poll: `claudeDir`, `pollInterval`, `repositories[]`, `hourlyBudget`, `weeklyBudget`. Mirrored from SQLite by `SettingsService`.
- **`SettingsService`** (SQLite = source of truth, mirrors to `config.json`) — the right place to store workspace config.
- **`/api/settings/detect-repos`** — already scans active session cwds and finds git repos. The seed for auto-onboarding.
- **SQLite `workspaces`/`projects`/`repositories` tables** — relational home for a workspace definition if we want it.

---

## Design: one config, derived defaults

Extend the **existing** `metrics/config.json` (+ SQLite settings) rather than inventing a parallel file. New/extended shape:

```jsonc
{
  "claudeDir": null,                     // null → derive from os.homedir()/.claude
  "pollInterval": 5,
  "workspace": {
    "name": "My Workspace",              // replaces "FlowerStorePH" in graph root + branding
    "root": "d:/MyWork",                 // optional; used for repo auto-scan
    "emoji": "🧠"                        // RootNode icon (default neutral)
  },
  "repositories": [
    // string (back-compat) OR object with optional enrichment:
    { "name": "my-api",  "path": "d:/MyWork/my-api",  "color": "#f59e0b", "agents": ["backend-engineer"] },
    { "name": "my-web",  "path": "d:/MyWork/my-web",  "agents": ["frontend-engineer"] }
  ],
  "agentRoles": {                        // OPTIONAL overrides; else derived from slug + hashed color
    "backend-engineer": { "displayName": "Backend Engineer", "color": "#f97316" }
  },
  "pricing": {                           // OPTIONAL; else default constants
    "modelLabel": "Sonnet 4.6",
    "input": 3.0, "output": 15.0, "cacheRead": 0.30, "cacheWrite": 3.75
  },
  "locale": "en-US"
}
```

**Zero-config behavior when a field is absent (the OSS default path):**
- `claudeDir` → `path.join(os.homedir(), '.claude')`.
- `repositories` → auto-detect from active session cwds (existing detect logic) and/or scan `workspace.root` for git dirs.
- `repositories[].agents` (ownership) → **optional**. Unset = agents and repos both render, just without opinionated ownership edges (no fake mapping invented). Optional 1:1-by-name inference behind a flag.
- Repo/role **colors** → deterministic hash of the name → palette (no hardcoded maps). Config `color` overrides win.
- `pricing` → current Sonnet-4.6 constants as defaults; label generic when overridden.
- `workspace.name/emoji` → "Workspace" + a neutral icon.
- `locale` → `en-US` (or browser locale on the frontend).

**Key refactor — `shared/agent-repos.js`: constant → loader.** Keep the exact same exports (`REPO_PRIMARY_AGENTS`, `AGENT_REPOS`, `ALL_REPOS`, `NON_REPO_KEYS`) so nothing downstream changes, but compute them from the loaded config (read `config.json` synchronously, cache by mtime, `refresh()` on poll). The `flowerstoreph` root-fallback key generalizes to `workspace.name`'s slug. Joel's current FlowerStore mapping moves **out of code and into his config**, so it stays working while the code becomes generic.

---

## Phased implementation (additive, each slice ends green)

Follow the standard recipe (small, reversible, `node --check` + `node --test` + `tsc --noEmit` green each slice; no regression to Joel's setup).

### P0 — Portable paths *(the real blocker; do first)* ✅ done (2026-07-28)
- New `shared/workspace-config.js` loader resolves `claudeDir` = `config.claudeDir` → `$SYNAPSE_CLAUDE_DIR` → `<home>/.claude`, and derives projects/sessions/agents/tasks paths from it (mtime-cached, re-read on change).
- `collectors/index.js` + `backend/server.js` now take paths from the loader; `settings-service.js` DEFAULTS derive from `os.homedir()`; `Settings.tsx` default handled in P3.
- **Outcome:** Synapse starts and observes on *any* machine/user; unchanged for Joel (his explicit `claudeDir` still wins).

### P1 — Config-driven repos + pricing ✅ done (2026-07-28)
- Collector reads `repoPaths` + `pricing` from the loader; deleted the `GIT_REPOS` array and the inline `PRICING` constant (Sonnet-4.6 numbers are now loader defaults, overridable via `config.pricing`).
- `SettingsService._mirrorToConfig` now **merges** onto the existing file so workspace-only keys (`workspace`, `repoAgents`, `pricing`, `agentRoles`) survive a Settings save.

### P2 — Config-driven agent↔repo mapping ✅ done (2026-07-28)
- `shared/agent-repos.js` is now a **loader** over `config.repoAgents` (repo name → agent slugs), resolving slugs → display names via `roleDisplayName()` and inverting the map. Same exports + new live `get*()` getters; graph-builder/insights/intelligence call the getters. Verified the resolved map is byte-identical to the old hardcoded one for Joel's config.
- `formatAgentName()` moved to the shared loader (generic, acronym-aware, honors `agentRoles[].displayName`); `inferProject()` uses `workspace.name`; root graph label = `workspace.name`; the `'AI Chatbot Engineer'` default fallbacks are now `'Unassigned'` / config-driven.
- **Verify:** `node --test` 63/63, `tsc --noEmit` clean, syntax-check all 9 touched files, smoke test confirms mapping + generic `<home>/.claude` fallback.

### P3 — Frontend de-hardcode
- Replace the 4 repo color maps + 2 role palettes with shared `repoColor(name)` / `roleColor(name)` utils (hash-based + config overrides).
- New `GET /api/workspace` → resolved `{ name, emoji, repoColors, roleColors, pricingLabel, locale }`; a `useWorkspace()` hook.
- `RootNode` reads workspace name/emoji; locale from config/browser (kill `en-PH`).

### P4 — Onboarding & OSS polish
- First-run: auto-generate a starter `config.json` from detected repos + `.claude/agents/*.md`; a Settings "Workspace" panel to edit name/emoji/pricing/mapping.
- Ship `synapse.config.example.json`; README "point Synapse at your workspace" section; strip residual branding; make DB/backup paths portable.
- **Auto-add repos ✅ done (2026-07-28):** the collector pings `POST /api/internal/auto-register` each poll; the backend auto-tracks any git repo you have a live Claude session in (adds to `repositories` via SettingsService + a default `project-manager` owner in `repoAgents` so it's never an orphan node). Scope = any git repo you work in. `metrics/config.example.json` shipped in P1.

---

## Cross-cutting

Add **C6 — Workspace Portability** to the roadmap's cross-cutting concerns: *every new feature must read workspace specifics from config, never hardcode a repo/role/path/brand.* Keeps us from regressing once the codebase is generic.

## Non-goals / preserved guarantees

- Still **zero-token, observer-only, local-first** — this is config plumbing, not new AI or write-back.
- Joel's FlowerStore setup keeps working **byte-for-byte** (his specifics just move into his own config).
- No change to the SQLite-as-truth / one-owner-per-entity architecture.
