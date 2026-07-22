# 11 — Dependencies

> All frameworks, libraries, external services, and build tools, taken from the four `package.json` files. Versions are the declared semver ranges.

---

## Frameworks (by process)

| Process | Framework | Version | package.json |
|---|---|---|---|
| Desktop shell | Electron | `^28.0.0` (devDep at root) | root |
| UI | React + React DOM | `^18.2.0` | frontend |
| UI build | Vite | `^5.0.11` | frontend |
| UI routing | React Router DOM | `^6.21.0` | frontend |
| Backend API | Express | `^4.18.2` | backend |
| Language | TypeScript | `^5.3.3` (frontend) | frontend |

---

## Frontend dependencies (`frontend/package.json`)

**Runtime:**
| Package | Version | Purpose |
|---|---|---|
| `react`, `react-dom` | `^18.2.0` | UI core |
| `react-router-dom` | `^6.21.0` | Client routing (9 pages) |
| `@xyflow/react` | `^12.11.2` | React Flow — the Agent Network graph |
| `recharts` | `^2.10.3` | Charts (Analytics, StatCard sparklines) |
| `framer-motion` | `^10.18.0` | Animations |
| `lucide-react` | `^0.303.0` | Icon set |
| `axios` | `^1.6.2` | REST client |
| `clsx` | `^2.1.0` | Conditional classNames |
| `tailwind-merge` | `^2.2.0` | Merge Tailwind classes (`cn()`) |
| `date-fns` | `^3.0.6` | Date utilities |
| `react-force-graph-2d` | `^1.29.1` | **Present but not used** — the graph uses `@xyflow/react`, not this. |

**Dev:**
| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.3.3` | Types + `tsc` build gate |
| `vite`, `@vitejs/plugin-react` | `^5.0.11` / `^4.2.1` | Dev server + build |
| `tailwindcss`, `autoprefixer`, `postcss` | `^3.4.0` / `^10.4.16` / `^8.4.33` | Styling pipeline |
| `eslint` + `@typescript-eslint/*` + react plugins | `^8.56.0` / `^6.17.0` | Linting |
| `@types/react`, `@types/react-dom` | `^18.2.x` | Types |

> Note: `PROJECT_DESCRIPTION.md`/`README.md` mention **shadcn/ui**; there is no `shadcn` dependency or `components/ui` directory in the code — styling is hand-written Tailwind utility classes.

---

## Backend dependencies (`backend/package.json`)

**Runtime:**
| Package | Version | Purpose |
|---|---|---|
| `express` | `^4.18.2` | HTTP server + routing |
| `ws` | `^8.21.1` | WebSocket server (`/ws`) |
| `cors` | `^2.8.5` | CORS middleware (all origins) |
| `fs-extra` | `^11.2.0` | `readJson`/`writeJson`/`pathExists` |
| `chokidar` | `^3.5.3` | **Declared but not used in `server.js`** (watching lives in the collector) |
| `node-cron` | `^3.0.3` | **Imported but never scheduled** — unused |

**Dev:** `nodemon` `^3.0.2` (dev server).

**Test:** `npm test` = `node --test` (runs `backend/lib/graph-builder.test.js`; no test framework dependency needed).

---

## Collector dependencies (`collectors/package.json`)

**Runtime:**
| Package | Version | Purpose |
|---|---|---|
| `simple-git` | `^3.21.0` | Git introspection (`status`, `log`) |
| `chokidar` | `^3.5.3` | File watchers on `.claude` + config |
| `fs-extra` | `^11.2.0` | JSON/file IO |
| `axios` | `^1.6.2` | POST `graph-refresh` to backend |

**Dev:** `nodemon` `^3.0.2`.

---

## Electron dependencies (`electron/package.json`)

| Package | Version | Purpose |
|---|---|---|
| `electron-is-dev` | `^2.0.0` | Detect dev vs packaged to decide backend spawn + load URL |

`electron` itself + `electron-builder` are declared at the **root** as devDependencies.

---

## Root dependencies (`package.json`)

**Dev only (orchestration + packaging):**
| Package | Version | Purpose |
|---|---|---|
| `concurrently` | `^8.2.2` | Run frontend+backend+collector+electron together |
| `wait-on` | `^7.2.0` | Hold Electron until Vite is up |
| `electron` | `^28.0.0` | Desktop runtime |
| `electron-builder` | `^24.9.1` | Package the desktop app |

`postinstall` chains `npm install` into `frontend/`, `backend/`, and `collectors/`.

---

## External services

**None.** This is a defining property of the app:
- No cloud APIs, no telemetry endpoints, no external network calls in the running code.
- No database server — storage is local JSON (see [03-data-storage.md](03-data-storage.md)).
- The only network traffic is `localhost` HTTP/WS between the frontend, backend, and collector.

---

## Claude dependencies

- **No Claude/Anthropic SDK or API client** is a dependency anywhere. Integration with Claude is purely **filesystem reads** of `C:\Users\joelr\.claude\` (see [07-claude-integration.md](07-claude-integration.md)).
- The app therefore consumes **zero LLM tokens** to monitor — by design.

---

## Build tools

| Tool | Where | Role |
|---|---|---|
| Vite | frontend | Dev server + production bundle (`tsc && vite build`) |
| TypeScript (`tsc`) | frontend | Type-check gate before build |
| Tailwind + PostCSS + Autoprefixer | frontend | CSS |
| ESLint | frontend | Lint (`--max-warnings 0`) |
| electron-builder | root | Package desktop app (appId `com.senjoeru.synapse`, output `dist/`) |
| nodemon | backend/collector | Auto-restart in dev |
| Node built-in test runner | backend | `node --test` for graph-builder |

**electron-builder `files` (packaged):** `electron/**`, `frontend/dist/**`, `backend/**`, `collectors/**`, `metrics/**`, `shared/**`.

---

## Dependency observations (state, not recommendations)

- `react-force-graph-2d` (frontend) — installed, not imported.
- `node-cron` (backend) — imported, never used.
- `chokidar` (backend) — declared, not used server-side (only the collector watches).
- `shadcn/ui` — referenced in prose docs, not actually a dependency.
- Each sub-package pins its own copies (`fs-extra`, `chokidar`, `axios` appear in multiple), installed independently via `postinstall`.
