/**
 * Repo ↔ agent mapping — derived from the workspace config (metrics/config.json),
 * NOT hardcoded. Shared by:
 *   - collectors/index.js         (infers which agents are "working" from cwd)
 *   - backend/lib/graph-builder.js (draws agent → repo edges)
 *   - backend insights/intelligence services (repo health enumeration)
 *
 * The ownership map lives in config as `repoAgents: { "<repo>": ["<agent-slug>"] }`;
 * this module resolves slugs → display names and inverts the map. When no
 * ownership is configured, repos and agents still appear — just without edges.
 *
 * Prefer the get*() functions (they re-read config live). The plain constants are
 * a load-time snapshot kept for back-compat with any caller that destructures.
 * See docs/roadmap/WORKSPACE-PORTABILITY.md.
 */
const { getConfig, roleDisplayName, allRepoNames } = require('./workspace-config');

/** Keys that are NOT real repositories (the workspace-root fallback bucket). */
function getNonRepoKeys() {
  const { workspace } = getConfig();
  return workspace.rootKey ? [workspace.rootKey] : [];
}

/** repo name → primary agent DISPLAY names (+ a workspace-root union bucket). */
function getRepoPrimaryAgents() {
  const cfg = getConfig();
  const map = {};
  for (const name of allRepoNames()) {
    map[name] = (cfg.repoAgents[name] || []).map(roleDisplayName);
  }
  // Root-cwd fallback: when Claude is open at the workspace root (not a specific
  // repo), attribute activity to every agent that owns something.
  const rootKey = cfg.workspace.rootKey;
  if (rootKey && !map[rootKey]) {
    const union = new Set();
    for (const names of Object.values(map)) names.forEach((n) => union.add(n));
    map[rootKey] = [...union];
  }
  return map;
}

/** Real repository names (excludes the non-repo root key). */
function getAllRepos() {
  const nonRepo = new Set(getNonRepoKeys());
  return allRepoNames().filter((r) => !nonRepo.has(r));
}

/** Inverted view: agent display name → [repo names] (excludes non-repo keys). */
function getAgentRepos() {
  const map = {};
  const nonRepo = new Set(getNonRepoKeys());
  for (const [repo, agents] of Object.entries(getRepoPrimaryAgents())) {
    if (nonRepo.has(repo)) continue;
    for (const agent of agents) {
      if (!map[agent]) map[agent] = [];
      if (!map[agent].includes(repo)) map[agent].push(repo);
    }
  }
  return map;
}

// Back-compat snapshots (computed once at load).
const REPO_PRIMARY_AGENTS = getRepoPrimaryAgents();
const AGENT_REPOS = getAgentRepos();
const ALL_REPOS = getAllRepos();
const NON_REPO_KEYS = getNonRepoKeys();

module.exports = {
  REPO_PRIMARY_AGENTS, AGENT_REPOS, ALL_REPOS, NON_REPO_KEYS,
  getRepoPrimaryAgents, getAgentRepos, getAllRepos, getNonRepoKeys,
};
