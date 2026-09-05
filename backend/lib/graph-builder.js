/**
 * Agent-Network graph builder.
 *
 * Transforms the metrics JSON produced by the collector into a React Flow
 * graph: Workspace (root) -> Projects -> Repos, with Agents edged to the repos
 * they own.
 *
 * Two independent stages (kept separate so layout can be swapped later):
 *   buildGraph()        -> { nodes, edges }  — topology + data, NO positions
 *   layoutGraph(graph)  -> { nodes, edges }  — same graph with x/y added
 *
 * Fully defensive: missing or malformed metrics files never throw — they
 * degrade to an empty graph (just the root node).
 */
const path = require('path');
const fs = require('fs-extra');
const { getAgentRepos, getAllRepos, getRepoPrimaryAgents } = require('../../shared/agent-repos');
const { getConfig } = require('../../shared/workspace-config');

const METRICS_DIR = path.join(__dirname, '../../metrics');

const ROOT_ID = 'root';

/* ── layout constants ──────────────────────────────────────────────── */
// Four tiers. Repos hang beneath the PROJECT that contains them, not beneath
// an agent — an agent typically works across several projects, so nesting
// repos under agents made one project look like the parent of everything.
// Agents sit between, with edges crossing down to whichever repos they own.
const ROOT_Y = 0;
const PROJECT_Y = 200;
const AGENT_Y = 430;
const REPO_Y = 680;
const PROJECT_GAP = 460; // horizontal spacing between projects
const AGENT_GAP = 320;   // horizontal spacing between agents
const REPO_GAP = 180;    // horizontal spacing between repos under one project

/* ── helpers ───────────────────────────────────────────────────────── */

function slug(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function projectNodeId(name) {
  return `project-${slug(name)}`;
}

function agentNodeId(name) {
  return `agent-${slug(name)}`;
}

function repoNodeId(name) {
  return `repo-${slug(name)}`;
}

/**
 * A task's `repos` may be an array of objects ({ name, branch, ... }) per the
 * live tasks.json schema, or an array of plain strings (older/hand-authored
 * boards). Normalize either shape to a clean list of repo-name strings.
 */
function normalizeRepoNames(repos) {
  if (!Array.isArray(repos)) return [];
  return repos
    .map(r => (typeof r === 'string' ? r : r && r.name))
    .filter(Boolean);
}

/**
 * True when a session's working directory points inside `repo`. Mirrors the
 * collector's cwd→repo matching so "working" state is attributed to the repo
 * the agent is ACTUALLY in — not every repo it happens to own.
 */
function cwdMatchesRepo(cwd, repo) {
  if (!cwd || !repo) return false;
  const norm = String(cwd).toLowerCase().replace(/\\/g, '/');
  const r = repo.toLowerCase();
  return norm.includes('/' + r) || norm.endsWith(r);
}

/** Inspector task ordering: active first, finished last. */
const TASK_STATUS_RANK = {
  Working: 0, Reviewing: 1, Testing: 2, Pending: 3, Completed: 4, Done: 4, Failed: 5,
};
function compareTasks(a, b) {
  const ra = TASK_STATUS_RANK[a.status] ?? 6;
  const rb = TASK_STATUS_RANK[b.status] ?? 6;
  if (ra !== rb) return ra - rb;                     // active statuses on top
  return (b.lastUpdatedMs || 0) - (a.lastUpdatedMs || 0); // then most-recent first
}

async function readMetric(file, fallback) {
  try {
    const p = path.join(METRICS_DIR, file);
    if (!(await fs.pathExists(p))) return fallback;
    const data = await fs.readJson(p);
    return data ?? fallback;
  } catch (_) {
    return fallback;
  }
}

/* ── stage 1: topology + data (no positions) ───────────────────────── */

async function buildGraph(preloaded) {
  // `preloaded` ({ agentsData, tasksData }) lets callers (tests) inject metrics
  // directly instead of reading metrics/*.json — production callers omit it.
  const [agentsData, tasksData] = preloaded
    ? [preloaded.agentsData || { agents: [] }, preloaded.tasksData || { tasks: [] }]
    : await Promise.all([
        readMetric('agents.json', { agents: [] }),
        readMetric('tasks.json', { tasks: [] }),
      ]);

  const agents = Array.isArray(agentsData.agents) ? agentsData.agents : [];
  const tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];

  // Config-driven repo topology (resolved live, not hardcoded).
  const ALL_REPOS = getAllRepos();
  const AGENT_REPOS = getAgentRepos();
  const REPO_PRIMARY_AGENTS = getRepoPrimaryAgents();

  // Tasks grouped by their assigned agent (for the inspector panel).
  // Keyed by a normalized slug of assignedAgent so human-written strings
  // ("AI Chatbot Engineer", "ai-chatbot-engineer", "Ai Chatbot engineer") all
  // attach to the same agent node regardless of casing/spacing — the previous
  // exact-string match silently dropped tasks whose name didn't match the
  // collector's formatAgentName() output verbatim.
  const tasksByAgentSlug = {};
  for (const t of tasks) {
    const key = slug(t.assignedAgent || 'Unassigned');
    if (!tasksByAgentSlug[key]) tasksByAgentSlug[key] = [];
    tasksByAgentSlug[key].push({
      id: String(t.id ?? ''),
      title: t.title || 'Untitled task',
      status: t.status || 'Pending',
      progress: typeof t.progress === 'number' ? t.progress : 0,
      priority: t.priority || 'Medium',
      repos: normalizeRepoNames(t.repos),
      lastUpdatedMs: t.lastUpdated ? (Date.parse(t.lastUpdated) || 0) : 0,
    });
  }

  const nodes = [];
  const edges = [];

  // Root ------------------------------------------------------------------
  const workingCount = agents.filter(a => a.status === 'Working').length;
  nodes.push({
    id: ROOT_ID,
    type: 'root',
    data: {
      label: getConfig().workspace.name,
      workingCount,
      agentCount: agents.length,
      repoCount: ALL_REPOS.length,
    },
  });

  // Projects --------------------------------------------------------------
  // One node per configured project, holding the repos it contains. With no
  // `projects` in config this is a single node named after the workspace, so
  // the graph looks exactly as it did before.
  const projects = getConfig().projects || [];
  const projectIdByRepo = {};
  for (const project of projects) {
    const id = projectNodeId(project.name);
    const owned = project.repositories.filter(r => ALL_REPOS.includes(r));
    for (const repo of owned) projectIdByRepo[repo] = id;

    nodes.push({
      id,
      type: 'project',
      data: {
        label: project.name,
        emoji: project.emoji || '',
        root: project.root || '',
        repoCount: owned.length,
      },
    });

    edges.push({
      id: `e-${ROOT_ID}-${id}`,
      source: ROOT_ID,
      target: id,
      data: { containment: true },
      markerEnd: { type: 'arrowclosed' },
    });
  }

  // Agents ----------------------------------------------------------------
  // The specific cwd each working agent is active in — used to light up only
  // the repo it is genuinely working in (see the repo loop below).
  const activeCwdByAgent = {};
  for (const a of agents) {
    if (a.status === 'Working' && a.activeCwd) activeCwdByAgent[a.name] = a.activeCwd;
  }

  const agentIdByName = {};
  for (const agent of agents) {
    const name = agent.name || 'Unknown Agent';
    const id = agentNodeId(name);
    agentIdByName[name] = id;
    const working = agent.status === 'Working';
    const agentTasks = (tasksByAgentSlug[slug(name)] || []).slice().sort(compareTasks);
    const repos = AGENT_REPOS[name] || [];

    nodes.push({
      id,
      type: 'agent',
      data: {
        label: name,
        status: working ? 'Working' : 'Idle',
        working,
        currentTask: agent.currentTask || '',
        lastUpdate: agent.lastUpdate || '',
        assignedProject: agent.assignedProject || 'General',
        activeCwd: agent.activeCwd || null,
        repoCount: repos.length,
        taskCount: agentTasks.length,
        tasks: agentTasks,
      },
    });

    edges.push({
      id: `e-${ROOT_ID}-${id}`,
      source: ROOT_ID,
      target: id,
      animated: working,
      data: { working },
      markerEnd: { type: 'arrowclosed' },
    });
  }

  // Repos -----------------------------------------------------------------
  // One node per real repo; an edge from every owning agent that exists.
  for (const repo of ALL_REPOS) {
    const owners = REPO_PRIMARY_AGENTS[repo] || [];
    const presentOwners = owners.filter(o => agentIdByName[o]);
    // A repo is "working" only when an owning agent is ACTUALLY active in this
    // repo's directory — not merely working somewhere else. This stops e.g.
    // one repo lighting up while its owning agent is really editing another.
    const repoWorking = presentOwners.some(o => cwdMatchesRepo(activeCwdByAgent[o], repo));
    const id = repoNodeId(repo);

    nodes.push({
      id,
      type: 'repo',
      data: {
        label: repo,
        working: repoWorking,
        owners: presentOwners,
        project: projectIdByRepo[repo] || null,
      },
    });

    // Containment: which project this repo belongs to. Distinct from the
    // ownership edges below, which say who works in it.
    const projectId = projectIdByRepo[repo];
    if (projectId) {
      edges.push({
        id: `e-${projectId}-${id}`,
        source: projectId,
        target: id,
        data: { containment: true },
        markerEnd: { type: 'arrowclosed' },
      });
    }

    for (const owner of presentOwners) {
      const agentId = agentIdByName[owner];
      const working = cwdMatchesRepo(activeCwdByAgent[owner], repo);
      edges.push({
        id: `e-${agentId}-${id}`,
        source: agentId,
        target: id,
        animated: working,
        data: { working },
        markerEnd: { type: 'arrowclosed' },
      });
    }
  }

  return { nodes, edges };
}

/* ── stage 2: deterministic layered layout ─────────────────────────── */

function layoutGraph(graph) {
  const nodes = graph.nodes.map(n => ({ ...n }));
  const edges = graph.edges;

  const agents = nodes.filter(n => n.type === 'agent');
  const repos = nodes.filter(n => n.type === 'repo');
  const projectNodes = nodes.filter(n => n.type === 'project');
  const root = nodes.find(n => n.type === 'root');

  if (root) root.position = { x: 0, y: ROOT_Y };

  // Projects in a centered row, each wide enough for the repos beneath it, so
  // a project with six repos doesn't overlap its neighbour.
  const reposByProject = {};
  const orphanRepos = [];
  for (const repo of repos) {
    const pid = repo.data.project;
    if (pid) (reposByProject[pid] ||= []).push(repo);
    else orphanRepos.push(repo);
  }

  const widthOf = p => Math.max(PROJECT_GAP, ((reposByProject[p.id] || []).length) * REPO_GAP);
  const totalWidth = projectNodes.reduce((sum, p) => sum + widthOf(p), 0);

  let cursor = -totalWidth / 2;
  for (const project of projectNodes) {
    const width = widthOf(project);
    const centerX = cursor + width / 2;
    project.position = { x: centerX, y: PROJECT_Y };
    cursor += width;

    // Its repos, centered beneath it.
    const group = reposByProject[project.id] || [];
    const span = (group.length - 1) * REPO_GAP;
    group.forEach((repo, i) => {
      repo.position = { x: centerX - span / 2 + i * REPO_GAP, y: REPO_Y };
    });
  }

  // A repo belonging to no project still needs a position — off to the right
  // of everything rather than stacked at the origin.
  const orphanSpan = (orphanRepos.length - 1) * REPO_GAP;
  const orphanStart = totalWidth / 2 + REPO_GAP;
  orphanRepos.forEach((repo, i) => {
    repo.position = { x: orphanStart + i * REPO_GAP - orphanSpan / 2, y: REPO_Y };
  });

  // Agents in a centered row between projects and repos. They span projects,
  // so they belong to no single column.
  const agentSpan = (agents.length - 1) * AGENT_GAP;
  agents.forEach((a, i) => {
    a.position = { x: -agentSpan / 2 + i * AGENT_GAP, y: AGENT_Y };
  });

  return { nodes, edges };
}

/** Convenience: build + lay out in one call. */
async function buildLaidOutGraph(preloaded) {
  return layoutGraph(await buildGraph(preloaded));
}

module.exports = { buildGraph, layoutGraph, buildLaidOutGraph, normalizeRepoNames };
