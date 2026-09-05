/**
 * Tests for IntelligenceService — Phase 3 computed insights.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
// Repo enumeration comes from the workspace config, so these assertions need a
// fixture rather than whatever workspace the developer happens to have.
process.env.SYNAPSE_CONFIG =
  require('node:path').join(__dirname, '..', 'lib', 'fixtures', 'workspace.config.json');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../lib/db');
const { TaskRepository } = require('../repositories/task-repository');
const { AnalyticsRepository } = require('../repositories/analytics-repository');
const { IntelligenceService } = require('./intelligence-service');

const NOW = new Date('2026-07-27T12:00:00.000Z');
const TODAY = '2026-07-27';

function setup(agentsJson) {
  const db = openDatabase(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-intel-'));
  if (agentsJson) fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify(agentsJson), 'utf8');

  const tasks = new TaskRepository(db);
  const analytics = new AnalyticsRepository(db);
  const now = NOW.toISOString();
  const base = {
    assigned_agent: 'Miguel Santos', priority: 'High', eta: 'x', notes: '',
    repos_json: '[]', source: 'claude-tasks', now,
  };
  const task = (id, status, lastUpdated, hash) =>
    tasks.upsert({ id, title: `Task ${id}`, status, progress: 0, task_last_updated: lastUpdated, content_hash: hash, ...base });

  task('work1', 'Working', now, 'h1');                     // active
  task('fail1', 'Failed', now, 'h2');                      // blocked
  task('stale1', 'Pending', '2026-06-01T00:00:00Z', 'h3'); // stalled (old)

  // commits: one today (chat-service), one old
  analytics.insertExecutionIfNew({ event_type: 'git_commit', entity_id: 'chat-service', title: 'c', detail: '', dedupe_key: 'commit:chat-service:aaa', occurred_at: '2026-07-27T09:00:00+00:00', now });
  analytics.insertExecutionIfNew({ event_type: 'git_commit', entity_id: 'dashboard', title: 'c', detail: '', dedupe_key: 'commit:dashboard:bbb', occurred_at: '2026-07-10T00:00:00+00:00', now });
  // a task completed today
  analytics.insertExecutionIfNew({ event_type: 'task_completed', entity_id: 'done1', title: 'Done One', detail: '', dedupe_key: 'task:done1:x', occurred_at: '2026-07-27T08:00:00+00:00', now });

  return { db, svc: new IntelligenceService(db, dir) };
}

test('today recap counts commits + completions for the given day only', () => {
  const { svc } = setup();
  const s = svc.summary(NOW);
  assert.equal(s.today.date, TODAY);
  assert.equal(s.today.commits.total, 1);                       // only the chat-svc commit is today
  assert.equal(s.today.commits.byRepo[0].repo, 'chat-service');
  assert.equal(s.today.tasksCompleted.length, 1);
  assert.equal(s.today.tasksCompleted[0].id, 'done1');
});

test('active/blocked classification', () => {
  const { svc } = setup();
  const s = svc.summary(NOW);
  assert.deepEqual(s.active.workingTasks.map((t) => t.id), ['work1']);
  assert.deepEqual(s.blocked.failedTasks.map((t) => t.id), ['fail1']);
  assert.deepEqual(s.blocked.stalledTasks.map((t) => t.id), ['stale1']); // Pending + old
});

test('repo activity state from last commit', () => {
  const { svc } = setup();
  const byRepo = Object.fromEntries(svc.summary(NOW).repos.map((r) => [r.repo, r]));
  assert.equal(byRepo['chat-service'].state, 'active');      // committed today
  assert.equal(byRepo['dashboard'].state, 'quiet');        // 17 days ago (>7, <30)
  assert.equal(byRepo['web-app'].state, 'no-data');             // never
});

test('working agents come from agents.json when present', () => {
  const { svc } = setup({ agents: [
    { name: 'Backend Engineer', displayName: 'Miguel Santos', title: 'Senior Backend Engineer', status: 'Working', activeCwd: 'd:/x/web-app' },
    { name: 'QA Engineer', status: 'Idle' },
  ] });
  const s = svc.summary(NOW);
  assert.equal(s.active.workingAgents.length, 1);
  assert.equal(s.active.workingAgents[0].name, 'Miguel Santos');
});
