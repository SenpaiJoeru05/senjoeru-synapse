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

const CONFIG_PATH = path.join(__dirname, '..', 'metrics', 'config.json');

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

/** Resolved, defaulted view of the workspace config. */
function getConfig() {
  const raw = readRawConfig();
  const claudeDir = resolveClaudeDir(raw);
  const opencodeDir = resolveOpencodeDir(raw);

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
      tasksFile: path.join(claudeDir, 'tasks.json'),
      opencodeDir,
      opencodeStorageDir: path.join(opencodeDir, 'storage'),
    },
    workspace,
    repoPaths,
    repoAgents,
    agentRoles,
    pricing,
    locale: raw.locale || 'en-US',
  };
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

module.exports = { getConfig, slugify, basename, formatAgentName, roleDisplayName, allRepoNames, CONFIG_PATH };
