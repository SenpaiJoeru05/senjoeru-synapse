/**
 * Workspace config loader — the SINGLE source of truth for everything that used
 * to be hardcoded to one workspace (the ".claude" location, the repo list, the
 * repo↔agent ownership map, model pricing, branding). Shared by the collector,
 * the backend, and shared/agent-repos.js so no process drifts.
 *
 * Reads metrics/config.json (mtime-cached; re-read automatically when it
 * changes). EVERY field is optional — sensible zero-config defaults let a fresh
 * clone run against any machine/workspace:
 *   - claudeDir   → $SYNAPSE_CLAUDE_DIR or <home>/.claude
 *   - repositories→ [] (repos auto-detected from sessions elsewhere)
 *   - repoAgents  → {} (no opinionated ownership; repos/agents still render)
 *   - pricing     → Sonnet 4.6 defaults
 *   - workspace   → { name:"Workspace", emoji:"🧠" }
 *
 * See docs/roadmap/WORKSPACE-PORTABILITY.md.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// SYNAPSE_CONFIG points the whole app at a different config file. Needed so
// tests can supply a fixture instead of reading whatever happens to be on the
// developer's machine — two graph tests used to pass only because the author's
// config named the repos they asserted on.
const CONFIG_PATH = process.env.SYNAPSE_CONFIG || path.join(REPO_ROOT, 'metrics', 'config.json');

// Pricing per MILLION tokens (config units); Claude Sonnet 4.6 defaults.
const DEFAULT_PRICING = { modelLabel: 'Sonnet 4.6', input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };

// Slug words kept fully-uppercased when formatting a role name from its slug.
const ACRONYMS = new Set([
  'ai', 'db', 'qa', 'cs', 'ui', 'ux', 'api', 'ml', 'llm', 'id', 'ci', 'cd',
  'ios', 'css', 'html', 'sql', 'pm', 'hr', 'it', 'seo', 'devops',
]);

let _cache = null;
let _mtime = -1;

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function basename(p) {
  return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

/**
 * Parent directory, for either separator.
 *
 * `path.dirname` only understands the host's separator, so a Windows path read
 * on Linux — a config written on one machine, or a test running in CI — yields
 * "." and every repo collapses into one group.
 */
function dirname(p) {
  const parts = String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

/** "ai-chatbot-engineer" → "AI Chatbot Engineer" (generic, acronym-aware). */
function formatAgentName(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function readRawConfig() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (_cache && stat.mtimeMs === _mtime) return _cache;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    _cache = raw;
    _mtime = stat.mtimeMs;
    return raw;
  } catch {
    return _cache || {};
  }
}

function resolveClaudeDir(raw) {
  const v = raw && typeof raw.claudeDir === 'string' ? raw.claudeDir.trim() : '';
  if (v) return v;
  if (process.env.SYNAPSE_CLAUDE_DIR) return process.env.SYNAPSE_CLAUDE_DIR;
  return path.join(os.homedir(), '.claude');
}

// OpenCode keeps its sessions outside the Claude tree entirely. Absent on
// machines that don't run it — the collector degrades to unavailable.
function resolveOpencodeDir(raw) {
  const v = raw && typeof raw.opencodeDir === 'string' ? raw.opencodeDir.trim() : '';
  if (v) return v;
  if (process.env.SYNAPSE_OPENCODE_DIR) return process.env.SYNAPSE_OPENCODE_DIR;
  return path.join(os.homedir(), '.local', 'share', 'opencode');
}

// The task board is Synapse's own format, not Claude Code's — Claude has no
// native concept of one. It used to default to ~/.claude/tasks.json, which put
// Synapse's data inside another tool's directory purely because that is where
// the agents writing it were first told to look. It now defaults beside the
// SQLite database instead: data/ is this app's own store, gitignored, and the
// agents are pointed at it by joeru-kit.
function resolveTasksFile(raw) {
  const v = raw && typeof raw.tasksFile === 'string' ? raw.tasksFile.trim() : '';
  if (v) return v;
  if (process.env.SYNAPSE_TASKS_FILE) return process.env.SYNAPSE_TASKS_FILE;
  return path.join(REPO_ROOT, 'data', 'tasks.json');
}

// joeru-kit — the portable roster + memory the assistant reads and writes.
// Defaults to a sibling of this repo, which is the usual layout, so nothing
// needs configuring until it lives somewhere else.
function resolveJoeruKitDir(raw) {
  const v = raw && typeof raw.joeruKitDir === 'string' ? raw.joeruKitDir.trim() : '';
  if (v) return v;
  if (process.env.SYNAPSE_JOERU_KIT) return process.env.SYNAPSE_JOERU_KIT;
  return path.resolve(__dirname, '..', '..', 'joeru-kit');
}

// `opencode serve` — the headless server the chat talks to. Separate from the
// storage dir above: reading past sessions needs only the files on disk, but
// holding a conversation needs a live process. Either can exist without the
// other, so they are configured independently.
function resolveOpencodeServerUrl(raw) {
  const v = raw && typeof raw.opencodeServerUrl === 'string' ? raw.opencodeServerUrl.trim() : '';
  if (v) return v.replace(/\/$/, '');
  if (process.env.SYNAPSE_OPENCODE_URL) return process.env.SYNAPSE_OPENCODE_URL.replace(/\/$/, '');
  // 4097, not OpenCode's default 4096 — the Kilo Code VS Code extension listens
  // on 4096, so the default collides on any machine that has it installed.
  return 'http://127.0.0.1:4097';
}

/** Resolved, defaulted view of the workspace config. */
function getConfig() {
  const raw = readRawConfig();
  const claudeDir = resolveClaudeDir(raw);
  const opencodeDir = resolveOpencodeDir(raw);
  const joeruKitDir = resolveJoeruKitDir(raw);

  const w = raw.workspace || {};
  const wsName = w.name || 'Workspace';
  const wsRoot = w.root || null;
  const workspace = {
    name: wsName,
    root: wsRoot,
    emoji: w.emoji || '🧠',
    slug: slugify(wsName),
    // Key used to recognise "the workspace root" cwd (vs a specific repo).
    rootKey: wsRoot ? basename(wsRoot).toLowerCase() : slugify(wsName),
  };

  // git-monitored repo PATHS (back-compat: bare strings or { path }).
  const repoPaths = (Array.isArray(raw.repositories) ? raw.repositories : [])
    .map((r) => (typeof r === 'string' ? r : r && r.path) || null)
    .filter(Boolean);

  // Ownership map: repo NAME → [agent slug]. Accept a dedicated `repoAgents`
  // object and/or inline `agents` on repository objects.
  const repoAgents = {};
  if (raw.repoAgents && typeof raw.repoAgents === 'object') {
    for (const [name, slugs] of Object.entries(raw.repoAgents)) {
      repoAgents[name] = Array.isArray(slugs) ? slugs : [];
    }
  }
  if (Array.isArray(raw.repositories)) {
    for (const r of raw.repositories) {
      if (r && typeof r === 'object' && r.name && Array.isArray(r.agents)) repoAgents[r.name] = r.agents;
    }
  }

  const agentRoles = raw.agentRoles && typeof raw.agentRoles === 'object' ? raw.agentRoles : {};

  // Projects group repos so the graph can say "these are my projects" rather
  // than implying one of them owns everything.
  //
  // Declaring them is optional. With none configured they are derived from each
  // repo's parent directory, because that is already how people organise work
  // on disk — `~/work/acme/api` and `~/work/acme/web` are obviously one project.
  // A new user therefore gets sensible grouping with no configuration, and it
  // keeps up on its own as repos are added.
  const declaredProjects = Array.isArray(raw.projects) ? raw.projects : [];
  const projects = declaredProjects.length
    ? declaredProjects
        .filter((p) => p && typeof p === 'object' && p.name)
        .map((p) => ({
          name: p.name,
          emoji: p.emoji || '',
          root: p.root || '',
          repositories: Array.isArray(p.repositories) ? p.repositories : [],
        }))
    : deriveProjects(repoPaths, wsName, w.emoji || '');

  // A repo named by no project still has to appear somewhere, so it falls to
  // the first — silently dropping it from the graph would be worse than
  // filing it imperfectly.
  const claimed = new Set(projects.flatMap((p) => p.repositories));
  const unclaimed = repoPaths.map(basename).filter((r) => !claimed.has(r));
  if (unclaimed.length && projects.length) projects[0].repositories.push(...unclaimed);

  const pm = { ...DEFAULT_PRICING, ...(raw.pricing || {}) };
  const pricing = {
    modelLabel: pm.modelLabel,
    perMillion: { input: pm.input, output: pm.output, cacheRead: pm.cacheRead, cacheWrite: pm.cacheWrite },
    perToken: {
      input: pm.input / 1e6,
      output: pm.output / 1e6,
      cacheRead: pm.cacheRead / 1e6,
      cacheWrite: pm.cacheWrite / 1e6,
    },
  };

  return {
    raw,
    claudeDir,
    paths: {
      claudeDir,
      projectsDir: path.join(claudeDir, 'projects'),
      sessionsDir: path.join(claudeDir, 'sessions'),
      agentsDir: path.join(claudeDir, 'agents'),
      tasksFile: resolveTasksFile(raw),
      opencodeDir,
      opencodeStorageDir: path.join(opencodeDir, 'storage'),
      joeruKitDir,
      memoryDir: path.join(joeruKitDir, 'memory'),
    },
    opencodeServerUrl: resolveOpencodeServerUrl(raw),
    workspace,
    projects,
    repoPaths,
    repoAgents,
    agentRoles,
    pricing,
    locale: raw.locale || 'en-US',
  };
}

/**
 * Group repos by the folder that contains them.
 *
 * Falls back to a single workspace-named project when there is nothing to group
 * — no repos yet on a fresh install, or every repo sitting in one directory, in
 * which case a tier of one adds nothing.
 */
function deriveProjects(repoPaths, wsName, wsEmoji) {
  const byParent = new Map();
  for (const p of repoPaths) {
    const parent = dirname(p);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(basename(p));
  }

  if (byParent.size < 2) {
    return [{
      name: wsName,
      emoji: wsEmoji,
      root: [...byParent.keys()][0] || '',
      repositories: repoPaths.map(basename),
    }];
  }

  return [...byParent.entries()]
    .map(([root, repositories]) => ({
      name: basename(root) || root,
      emoji: '',
      root,
      repositories,
    }))
    .sort((a, b) => b.repositories.length - a.repositories.length);
}

/** Display name for an agent slug — config override wins, else derived. */
function roleDisplayName(slug) {
  const cfg = getConfig();
  const override = cfg.agentRoles[slug] && cfg.agentRoles[slug].displayName;
  return override || formatAgentName(slug);
}

/** All known repo NAMES = basenames of monitored paths ∪ ownership-map keys. */
function allRepoNames() {
  const cfg = getConfig();
  const set = new Set();
  for (const p of cfg.repoPaths) set.add(basename(p));
  for (const name of Object.keys(cfg.repoAgents)) set.add(name);
  return [...set];
}

module.exports = {
  getConfig, slugify, basename, formatAgentName, roleDisplayName, allRepoNames,
  deriveProjects, CONFIG_PATH,
};
