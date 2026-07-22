/**
 * Canonical repo <-> agent mapping — the single source of truth shared by:
 *   - collectors/index.js  (infers which agents are "working" from active repos)
 *   - backend/lib/graph-builder.js  (draws agent -> repo edges)
 *
 * Keyed by repo directory name -> primary agent DISPLAY names (as produced by
 * the collector's formatAgentName(), e.g. "AI Chatbot Engineer").
 *
 * NOTE: 'flowerstoreph' is the project-root fallback used when Claude Code is
 * open at the workspace root — it is NOT a real repository and must be excluded
 * from repo nodes in the graph (see NON_REPO_KEYS).
 */
const REPO_PRIMARY_AGENTS = {
  'fs-llm-service': ['AI Chatbot Engineer'],
  'chat-widget':    ['AI Chatbot Engineer', 'Frontend Engineer'],
  'cs-dashboard':   ['Frontend Engineer'],
  'fsweb':          ['Backend Engineer'],
  'seller-page':    ['Backend Engineer'],
  // project-root fallback — not a real repo node
  'flowerstoreph':  ['AI Chatbot Engineer', 'Backend Engineer'],
};

// Keys in REPO_PRIMARY_AGENTS that are NOT real repositories.
const NON_REPO_KEYS = ['flowerstoreph'];

/**
 * Inverted view: agent display name -> [repo names], excluding NON_REPO_KEYS.
 * Used by the graph-builder to attach repos beneath their owning agent.
 */
function buildAgentRepos() {
  const map = {};
  for (const [repo, agents] of Object.entries(REPO_PRIMARY_AGENTS)) {
    if (NON_REPO_KEYS.includes(repo)) continue;
    for (const agent of agents) {
      if (!map[agent]) map[agent] = [];
      if (!map[agent].includes(repo)) map[agent].push(repo);
    }
  }
  return map;
}

const AGENT_REPOS = buildAgentRepos();

// Flat list of real repository names (no fallbacks).
const ALL_REPOS = Object.keys(REPO_PRIMARY_AGENTS).filter(r => !NON_REPO_KEYS.includes(r));

module.exports = { REPO_PRIMARY_AGENTS, AGENT_REPOS, ALL_REPOS, NON_REPO_KEYS };
