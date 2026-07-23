/**
 * Tests for AnalyticsService — snapshotting runtime JSON into permanent history.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../lib/db');
const { AnalyticsRepository } = require('../repositories/analytics-repository');
const { AnalyticsService } = require('./analytics-service');
const { TaskRepository } = require('../repositories/task-repository');

function setup(metricsFiles = {}) {
  const db = openDatabase(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-metrics-'));
  for (const [name, obj] of Object.entries(metricsFiles)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(obj), 'utf8');
  }
  const repo = new AnalyticsRepository(db);
  const svc = new AnalyticsService(repo, dir);
  return { db, dir, repo, svc };
}

test('snapshotTokens writes per-day token + cost history and is idempotent', () => {
  const { repo, svc } = setup({
    'tokens.json': { daily: [
      { day: 'Mon', date: '2026-07-20', tokens: 1000, cost: 1.5 },
      { day: 'Tue', date: '2026-07-21', tokens: 2000, cost: 3.0 },
    ] },
  });
  assert.equal(svc.snapshotTokens(new Date().toISOString()), 2);
  assert.equal(repo.getTokenHistory().length, 2);
  assert.equal(repo.getCostHistory().length, 2);

  // Re-run with an updated "today" value → still 2 rows, value updated.
  fs.writeFileSync(path.join(svc.metricsDir, 'tokens.json'), JSON.stringify({
    daily: [
      { day: 'Mon', date: '2026-07-20', tokens: 1000, cost: 1.5 },
      { day: 'Tue', date: '2026-07-21', tokens: 2500, cost: 3.7 }, // grew
    ],
  }), 'utf8');
  svc.snapshotTokens(new Date().toISOString());
  const hist = repo.getTokenHistory();
  assert.equal(hist.length, 2); // no duplicate day
  assert.equal(hist.find((r) => r.bucket_date === '2026-07-21').tokens, 2500);
});

test('snapshotMetrics records headline counts for the day', () => {
  const { repo, svc } = setup({
    'agents.json': { agents: [
      { name: 'A', status: 'Working' }, { name: 'B', status: 'Idle' }, { name: 'C', status: 'Working' },
    ] },
    'tasks.json': { tasks: [
      { id: '1', status: 'Completed' }, { id: '2', status: 'Working' }, { id: '3', status: 'Pending' },
    ] },
    'git.json': { repos: [{ name: 'r1' }, { name: 'r2' }] },
  });
  const m = svc.snapshotMetrics(new Date().toISOString());
  assert.equal(m.agents_total, 3);
  assert.equal(m.agents_working, 2);
  assert.equal(m.tasks_total, 3);
  assert.equal(m.tasks_completed, 1);
  assert.equal(m.repos_tracked, 2);
  assert.equal(repo.getMetrics('agents_working')[0].metric_value, 2);
});

test('recordGitCommits appends commit events idempotently', () => {
  const files = { 'git.json': { repos: [
    { name: 'fs-llm-service', commits: [
      { hash: 'aaa111', message: 'feat: x', date: '2026-07-21T00:00:00+08:00' },
      { hash: 'bbb222', message: 'fix: y', date: '2026-07-20T00:00:00+08:00' },
    ] },
  ] } };
  const { repo, svc } = setup(files);
  assert.equal(svc.recordGitCommits(new Date().toISOString()), 2);
  assert.equal(svc.recordGitCommits(new Date().toISOString()), 0); // dedup
  assert.equal(repo.executionCount(), 2);
});

test('reconcileTaskCompletions records only completed tasks, once', () => {
  const { db, repo, svc } = setup();
  const tasks = new TaskRepository(db);
  const now = new Date().toISOString();
  const base = {
    title: 't', assigned_agent: 'Backend Engineer', priority: 'High', eta: 'x',
    notes: '', repos_json: '[]', source: 'claude-tasks', task_last_updated: now, now,
  };
  tasks.upsert({ id: 'done1', status: 'Completed', progress: 100, content_hash: 'h1', ...base });
  tasks.upsert({ id: 'wip1', status: 'Working', progress: 20, content_hash: 'h2', ...base });

  assert.equal(svc.reconcileTaskCompletions(tasks, now), 1);
  assert.equal(svc.reconcileTaskCompletions(tasks, now), 0); // idempotent
  const events = repo.getExecutionHistory(10);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'task_completed');
  assert.equal(events[0].entity_id, 'done1');
});

test('snapshotAll runs everything and returns a summary', () => {
  const { svc } = setup({
    'tokens.json': { daily: [{ date: '2026-07-21', tokens: 5, cost: 0.1 }] },
    'git.json': { repos: [{ name: 'r', commits: [{ hash: 'h1', message: 'm', date: 'd' }] }] },
    'agents.json': { agents: [] },
    'tasks.json': { tasks: [] },
  });
  const s = svc.snapshotAll(null);
  assert.equal(s.tokenDays, 1);
  assert.equal(s.commitsAdded, 1);
  assert.equal(s.completionsAdded, 0);
  assert.equal(typeof s.metrics.repos_tracked, 'number');
});
