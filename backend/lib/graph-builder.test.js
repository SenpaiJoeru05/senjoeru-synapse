/**
 * Tests for the Agent-Network graph builder.
 *
 * Dependency-free — uses Node's built-in test runner:
 *   node --test backend/lib/graph-builder.test.js
 *
 * Focus: the task->agent join (regression for the name-format mismatch bug),
 * tolerant repo-name parsing, and working-state propagation to repos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Point the whole config chain at a fixture BEFORE anything loads it. Without
// this the graph reads whatever workspace the developer happens to have, and
// the repo-ownership assertions below pass or fail by accident.
process.env.SYNAPSE_CONFIG = path.join(__dirname, 'fixtures', 'workspace.config.json');

const {
  buildGraph,
  buildLaidOutGraph,
  normalizeRepoNames,
} = require('./graph-builder');

/* ── helpers ───────────────────────────────────────────────────────── */

function agentNode(graph, label) {
  return graph.nodes.find(n => n.type === 'agent' && n.data.label === label);
}
function repoNode(graph, label) {
  return graph.nodes.find(n => n.type === 'repo' && n.data.label === label);
}

// A minimal agents fixture matching what the collector emits.
const AGENTS = {
  agents: [
    { name: 'AI Chatbot Engineer', status: 'Working', assignedProject: 'acme', activeCwd: 'd:\\acme\\chat-service' },
    { name: 'Backend Engineer', status: 'Idle', assignedProject: 'acme' },
    { name: 'Frontend Engineer', status: 'Idle' },
  ],
};

/* ── normalizeRepoNames (bug #3) ───────────────────────────────────── */

test('normalizeRepoNames handles object-shaped repos (live schema)', () => {
  const out = normalizeRepoNames([
    { name: 'web-app', branch: 'main' },
    { name: 'chat-service' },
  ]);
  assert.deepEqual(out, ['web-app', 'chat-service']);
});

test('normalizeRepoNames handles plain-string repos (legacy schema)', () => {
  assert.deepEqual(normalizeRepoNames(['web-app', 'widget']), ['web-app', 'widget']);
});

test('normalizeRepoNames drops empty/malformed entries and non-arrays', () => {
  assert.deepEqual(normalizeRepoNames([{ name: '' }, null, {}, 'ok']), ['ok']);
  assert.deepEqual(normalizeRepoNames(undefined), []);
  assert.deepEqual(normalizeRepoNames('nope'), []);
});

/* ── task -> agent join (bug #1) ───────────────────────────────────── */

test('task attaches to agent when assignedAgent matches display name exactly', async () => {
  const tasks = { tasks: [
    { id: 't1', title: 'Fix refund flow', assignedAgent: 'AI Chatbot Engineer', status: 'Working', progress: 40 },
  ] };
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: tasks });
  const node = agentNode(graph, 'AI Chatbot Engineer');
  assert.equal(node.data.tasks.length, 1);
  assert.equal(node.data.tasks[0].title, 'Fix refund flow');
});

test('task attaches despite casing/spacing differences (the regression)', async () => {
  const tasks = { tasks: [
    { id: 't1', title: 'slug form', assignedAgent: 'ai-chatbot-engineer' },
    { id: 't2', title: 'lower words', assignedAgent: 'ai chatbot engineer' },
    { id: 't3', title: 'weird caps', assignedAgent: 'Ai  Chatbot   Engineer' },
  ] };
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: tasks });
  const node = agentNode(graph, 'AI Chatbot Engineer');
  const titles = node.data.tasks.map(t => t.title).sort();
  assert.deepEqual(titles, ['lower words', 'slug form', 'weird caps']);
});

test('task for a different agent does not leak onto the wrong agent', async () => {
  const tasks = { tasks: [
    { id: 't1', title: 'backend task', assignedAgent: 'Backend Engineer' },
    { id: 't2', title: 'chatbot task', assignedAgent: 'AI Chatbot Engineer' },
  ] };
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: tasks });
  assert.deepEqual(agentNode(graph, 'Backend Engineer').data.tasks.map(t => t.title), ['backend task']);
  assert.deepEqual(agentNode(graph, 'AI Chatbot Engineer').data.tasks.map(t => t.title), ['chatbot task']);
  assert.equal(agentNode(graph, 'Frontend Engineer').data.tasks.length, 0);
});

test('task with no matching agent is dropped, never crashes', async () => {
  const tasks = { tasks: [
    { id: 't1', title: 'orphan', assignedAgent: 'Nonexistent Agent' },
  ] };
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: tasks });
  for (const n of graph.nodes.filter(x => x.type === 'agent')) {
    assert.equal(n.data.tasks.length, 0);
  }
});

test('task repos flow through in the node data (both shapes)', async () => {
  const tasks = { tasks: [
    { id: 't1', title: 'obj repos', assignedAgent: 'AI Chatbot Engineer', repos: [{ name: 'chat-service' }] },
    { id: 't2', title: 'str repos', assignedAgent: 'AI Chatbot Engineer', repos: ['widget'] },
  ] };
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: tasks });
  const byTitle = Object.fromEntries(agentNode(graph, 'AI Chatbot Engineer').data.tasks.map(t => [t.title, t.repos]));
  assert.deepEqual(byTitle['obj repos'], ['chat-service']);
  assert.deepEqual(byTitle['str repos'], ['widget']);
});

test('agent tasks are ordered active-first, then most-recently-updated', async () => {
  const tasks = { tasks: [
    { id: 'a', title: 'old done',   assignedAgent: 'AI Chatbot Engineer', status: 'Completed', lastUpdated: '2026-07-01T00:00:00Z' },
    { id: 'b', title: 'pending',    assignedAgent: 'AI Chatbot Engineer', status: 'Pending',   lastUpdated: '2026-07-10T00:00:00Z' },
    { id: 'c', title: 'active new', assignedAgent: 'AI Chatbot Engineer', status: 'Working',   lastUpdated: '2026-07-16T00:00:00Z' },
    { id: 'd', title: 'active old', assignedAgent: 'AI Chatbot Engineer', status: 'Working',   lastUpdated: '2026-07-02T00:00:00Z' },
  ] };
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: tasks });
  const order = agentNode(graph, 'AI Chatbot Engineer').data.tasks.map(t => t.title);
  // Working before Pending before Completed; within Working, newest first.
  assert.deepEqual(order, ['active new', 'active old', 'pending', 'old done']);
})

/* ── working-state propagation & structure ─────────────────────────── */

test('root reports the working-agent count', async () => {
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: { tasks: [] } });
  const root = graph.nodes.find(n => n.type === 'root');
  assert.equal(root.data.workingCount, 1);
  assert.equal(root.data.agentCount, 3);
});

test('a repo owned by a working agent is marked working; edges animate', async () => {
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: { tasks: [] } });
  // AI Chatbot Engineer owns chat-service and is Working.
  assert.equal(repoNode(graph, 'chat-service').data.working, true);
  const edge = graph.edges.find(e => e.target === 'repo-chat-service' && e.source === 'agent-ai-chatbot-engineer');
  assert.ok(edge, 'expected an agent->repo edge');
  assert.equal(edge.animated, true);
});

test('a repo only lights up when its owner is active in THAT repo (bug #1)', async () => {
  // Backend Engineer owns web-app AND seller-portal, but is working in seller-portal.
  const agents = { agents: [
    { name: 'Backend Engineer', status: 'Working', activeCwd: 'd:\\acme\\seller-portal' },
  ] };
  const graph = await buildGraph({ agentsData: agents, tasksData: { tasks: [] } });
  assert.equal(repoNode(graph, 'seller-portal').data.working, true, 'active repo should light up');
  assert.equal(repoNode(graph, 'web-app').data.working, false, 'idle repo must NOT light up');

  const sellerEdge = graph.edges.find(e => e.target === 'repo-seller-portal' && e.source === 'agent-backend-engineer');
  const webAppEdge  = graph.edges.find(e => e.target === 'repo-web-app' && e.source === 'agent-backend-engineer');
  assert.equal(sellerEdge.animated, true);
  assert.equal(webAppEdge.animated, false);
})

test('a working agent with no matching repo cwd lights up no repo', async () => {
  // Active at the workspace root, not in a specific repo.
  const agents = { agents: [
    { name: 'Backend Engineer', status: 'Working', activeCwd: 'd:\\acme' },
  ] };
  const graph = await buildGraph({ agentsData: agents, tasksData: { tasks: [] } });
  assert.equal(graph.nodes.filter(n => n.type === 'repo' && n.data.working).length, 0);
})

test('buildLaidOutGraph assigns positions to every node', async () => {
  const graph = await buildLaidOutGraph({ agentsData: AGENTS, tasksData: { tasks: [] } });
  for (const n of graph.nodes) {
    assert.equal(typeof n.position.x, 'number');
    assert.equal(typeof n.position.y, 'number');
  }
});

test('degrades to a root-only-ish graph on empty input, never throws', async () => {
  const graph = await buildGraph({ agentsData: { agents: [] }, tasksData: { tasks: [] } });
  assert.ok(graph.nodes.find(n => n.type === 'root'));
  assert.equal(graph.nodes.filter(n => n.type === 'agent').length, 0);
});

/* ── projects tier ─────────────────────────────────────────────────── */

test('repos are contained by their project, and agents still own them', async () => {
  const graph = await buildGraph({ agentsData: AGENTS, tasksData: { tasks: [] } });

  const projects = graph.nodes.filter(n => n.type === 'project');
  assert.ok(projects.length >= 1, 'expected at least one project node');

  // Every repo belongs to exactly one project, via a containment edge.
  for (const repo of graph.nodes.filter(n => n.type === 'repo')) {
    const containment = graph.edges.filter(
      e => e.target === repo.id && e.data && e.data.containment,
    );
    assert.equal(containment.length, 1, `${repo.data.label} needs exactly one project`);
    assert.equal(containment[0].source, repo.data.project);
  }

  // Containment must not have replaced ownership: an agent that owns a repo
  // still has its own edge to it. Agents span projects, so the two are
  // different relationships and both have to survive.
  const owned = graph.nodes.find(n => n.type === 'repo' && (n.data.owners || []).length);
  if (owned) {
    const ownership = graph.edges.filter(
      e => e.target === owned.id && !(e.data && e.data.containment),
    );
    assert.ok(ownership.length >= 1, `${owned.data.label} lost its owning-agent edge`);
  }
});

test('every project node is laid out clear of its neighbours', async () => {
  const graph = await buildLaidOutGraph({ agentsData: AGENTS, tasksData: { tasks: [] } });
  const projects = graph.nodes.filter(n => n.type === 'project');

  for (const p of projects) assert.equal(typeof p.position.x, 'number');

  const xs = projects.map(p => p.position.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i] - xs[i - 1] > 0, 'two projects share a column');
  }

  // Repos sit below their project, never above it.
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  for (const repo of graph.nodes.filter(n => n.type === 'repo' && n.data.project)) {
    assert.ok(repo.position.y > byId[repo.data.project].position.y,
      `${repo.data.label} is not below its project`);
  }
});
