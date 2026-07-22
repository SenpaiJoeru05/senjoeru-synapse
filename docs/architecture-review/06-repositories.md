# 06 — Repositories

> How Synapse knows about, discovers, and monitors code repositories.

---

## Supported repositories

The canonical set of repositories is defined in [shared/agent-repos.js](../../shared/agent-repos.js) as the keys of `REPO_PRIMARY_AGENTS` (minus `NON_REPO_KEYS`):

| Repo name | Owning agent(s) | Real repo node? |
|---|---|---|
| `fs-llm-service` | AI Chatbot Engineer | ✅ |
| `chat-widget` | AI Chatbot Engineer, Frontend Engineer | ✅ |
| `cs-dashboard` | Frontend Engineer | ✅ |
| `fsweb` | Backend Engineer | ✅ |
| `seller-page` | Backend Engineer | ✅ |
| `flowerstoreph` | AI Chatbot Engineer, Backend Engineer | ❌ (project-root fallback, in `NON_REPO_KEYS`) |

`ALL_REPOS` (the 5 real ones) is exported and used by the graph-builder for the repo layer of the Agent Network graph. `flowerstoreph` exists only to attribute activity when a session's cwd is the FlowerStorePH workspace root rather than a specific repo.

> These repo names are also hardcoded into UI color maps (badge colors) in [Overview.tsx](../../frontend/src/pages/Overview.tsx), [Tasks.tsx](../../frontend/src/pages/Tasks.tsx), and [Agents.tsx](../../frontend/src/pages/Agents.tsx) for the same five repos.

---

## Three separate notions of "repository"

Synapse tracks repositories in **three distinct, only-partially-overlapping** places. This is important and a source of the discrepancies noted below.

| # | Where | Used for | Repo list source |
|---|---|---|---|
| 1 | `REPO_PRIMARY_AGENTS` / `ALL_REPOS` ([shared/agent-repos.js](../../shared/agent-repos.js)) | The **Agent Network graph** (repo nodes + agent↔repo edges) and Working-state attribution | Hardcoded map (5 repos) |
| 2 | `collectGit()` git list ([collectors/index.js](../../collectors/index.js)) | The **Git page** data (`git.json`) | `config.json.repositories` if set, else hardcoded `GIT_REPOS` |
| 3 | Settings "Monitored Repositories" ([Settings.tsx](../../frontend/src/pages/Settings.tsx) → `config.json`) | Editing the list used by #2 | User-edited via UI or auto-detect |

The hardcoded `GIT_REPOS` fallback in `collectGit()`:
```js
['d:\\FlowerStorePH\\fs-llm-service', 'd:\\FlowerStorePH\\cs-dashboard',
 'd:\\FlowerStorePH\\chat-widget', 'd:\\FlowerStorePH\\fsweb']
```
The live `config.json.repositories` currently holds `fs-llm-service`, `cs-dashboard`, `chat-widget`.

> Consequence: `seller-page` and `fsweb` are graph-known (#1) but not necessarily git-monitored (#2/#3), and the git list uses absolute Windows paths while the graph uses bare repo names. The two are reconciled only by string matching on the repo directory basename.

---

## How repositories are discovered

Two mechanisms:

### 1. Manual configuration (Settings page)
- The user adds an absolute repo path in Settings → saved to `config.json.repositories`.
- `collectGit()` reads that list on the next poll (the collector watches `config.json`, so changes take effect immediately).

### 2. Auto-detect from Claude sessions
- Endpoint: `GET /api/settings/detect-repos` ([backend/server.js](../../backend/server.js)).
- Reads every `.claude/sessions/*.json`, collects each `cwd`.
- For each cwd: if it is itself a git repo (`.git` present) it's added; otherwise its **immediate subdirectories** are scanned for `.git`.
- Returns `{ detected, newRepos }` where `newRepos` excludes repos already in `config.json`.
- The Settings page shows detected repos with an "Add" button; adding writes them into `config.json` on save.

There is **no auto-detection feeding the graph** — the graph's repo set is always the hardcoded `ALL_REPOS`.

---

## Current repository metadata

Per monitored repo, `collectGit()` stores (via `simple-git`) into `git.json`:

- `path`, `name` (basename)
- `branch` / `current`, `tracking` (upstream)
- `files` (raw status entries), `staged`, `modified`, `created`, `deleted`
- `commits` — last 5, each `{ hash (7-char), message, author, date }`
- `ahead`, `behind`

Repos whose path doesn't exist on disk are silently skipped; git errors per repo are logged and skipped without failing the whole collection.

Example from the live `git.json`: `fs-llm-service` on branch `dev`, tracking `origin/dev`, 17 staged files, 5 recent commits, ahead/behind 0.

---

## Project organization

- All monitored repos live under `d:\FlowerStorePH\` on the workstation.
- The Agent Network graph organizes them hierarchically: **FlowerStorePH (root) → agents → repos**, where each repo is placed beneath its first owning agent (`layoutGraph` in [graph-builder.js](../../backend/lib/graph-builder.js)).
- Token analytics group by **Claude project directory** (a different grouping than git repos): `formatProjectName()` turns dir names like `d--JOELRAYTON-WORKS-senjoeru-synapse` into readable project names, and `FlowerStorePH-*` into `FlowerStorePH / *`.

---

## Multi-project support

- **Token/session tracking is multi-project by construction** — `collectTokens()` walks *every* project directory under `.claude/projects/` (not just FlowerStorePH). The live `tokens.json` `byProject` shows `FlowerStorePH`, `senjoeru synapse`, `portfolio v2`, `cielo portfolio`, `ai resume builder`.
- **The graph and repo-monitoring are FlowerStorePH-specific** — the hardcoded `REPO_PRIMARY_AGENTS` and `GIT_REPOS` only know FlowerStorePH repos. Other projects appear in token analytics but not as graph nodes or Git-page repos.
- The `PROJECT_DESCRIPTION.md` lists "Full multi-project support" as a **roadmap** item, confirming it is partial today.

---

## Current limitations (state, not recommendations)

- **Three unsynchronized repo lists** (graph map vs git list vs settings) — a repo can appear in one and not the others.
- **Hardcoded paths** — `GIT_REPOS` and the `REPO_PRIMARY_AGENTS` map are baked into source; adding a repo to the *graph* requires a code edit.
- **`seller-page`** is in the graph map and UI color maps but not in the default git/config list, so it typically renders as an idle repo node with no git data.
- **Absolute Windows paths** — the git list uses `d:\...` paths; matching to graph repo names relies on directory-basename string matching (`cwdMatchesRepo`).
- Graph repo set cannot be discovered or configured at runtime (unlike the git list).
