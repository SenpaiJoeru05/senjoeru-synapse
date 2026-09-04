/**
 * Tests for InsightsService — Phase 5 computed analytics.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../lib/db');
const { AnalyticsRepository } = require('../repositories/analytics-repository');
const { ObservationRepository } = require('../repositories/observation-repository');
const { InsightsService } = require('./insights-service');

const NOW = new Date('2026-07-27T12:00:00.000Z');

function seeded() {
  const db = openDatabase(':memory:');
  const a = new AnalyticsRepository(db);
  const o = new ObservationRepository(db);
  const now = NOW.toISOString();

  a.insertExecutionIfNew({ event_type: 'git_commit', entity_id: 'fs-llm-service', title: 'c', detail: '', dedupe_key: 'commit:fs-llm-service:x', occurred_at: '2026-07-27T09:00:00+00:00', now });
  a.insertExecutionIfNew({ event_type: 'task_completed', entity_id: 't1', title: 'done', detail: '', dedupe_key: 'task:t1:x', occurred_at: '2026-07-26T09:00:00+00:00', now });
  a.insertExecutionIfNew({ event_type: 'task_completed', entity_id: 't2', title: 'done', detail: '', dedupe_key: 'task:t2:x', occurred_at: '2026-07-25T09:00:00+00:00', now });
  a.upsertTokenDay({ bucket_date: '2026-07-27', tokens: 1000, cost: 2.5, now });

  // one ended session (30 min) + one still active
  const t0 = '2026-07-27T08:00:00.000Z', t1 = '2026-07-27T08:30:00.000Z';
  o.upsertSession({ session_id: 's1', pid: 1, cwd: 'd:/x/fsweb', repo: 'fsweb', kind: 'i', version: '1', started_at: '1', now: t0 });
  o.upsertSession({ session_id: 's1', pid: 1, cwd: 'd:/x/fsweb', repo: 'fsweb', kind: 'i', version: '1', started_at: '1', now: t1 });
  o.markSessionEnded('s1', t1);
  o.upsertSession({ session_id: 's2', pid: 2, cwd: 'd:/x/fs-llm', repo: 'fs-llm', kind: 'i', version: '1', started_at: '1', now });

  return new InsightsService(db);
}

test('velocity: zero-filled series + totals', () => {
  const s = seeded().summary(NOW, 30);
  assert.equal(s.velocity.series.length, 30);
  assert.equal(s.velocity.totalCommits, 1);
  assert.equal(s.velocity.totalCompleted, 2);
});

test('repo health reflects commit counts', () => {
  const s = seeded().summary(NOW, 30);
  const fsllm = s.repoHealth.find((r) => r.repo === 'fs-llm-service');
  assert.equal(fsllm.commits, 1);
  assert.equal(fsllm.daysSince, 0);
});

test('cost totals + daily series', () => {
  const s = seeded().summary(NOW, 30);
  assert.equal(s.cost.totalTokens, 1000);
  assert.equal(s.cost.totalCost, 2.5);
  assert.ok(s.cost.series.some((d) => d.tokens === 1000));
});

test('session analytics: total, active, avg duration, hours', () => {
  const s = seeded().summary(NOW, 30);
  assert.equal(s.sessions.total, 2);
  assert.equal(s.sessions.activeNow, 1);
  assert.equal(s.sessions.avgDurationMin, 30);   // s1 ran 30 min
  assert.equal(s.sessions.byHour.length, 24);
});
