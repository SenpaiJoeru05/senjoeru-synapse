/**
 * Tests for AttentionService — the "needs you" queue.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { openDatabase } = require('../lib/db');
const { TaskRepository } = require('../repositories/task-repository');
const { AttentionService } = require('./attention-service');

const NOW = new Date('2026-07-28T12:00:00.000Z');

function task(repo, over, now) {
  repo.upsert({
    id: over.id, title: over.title, assigned_agent: over.agent || null,
    status: over.status, progress: over.progress || 0, priority: 'High',
    eta: '', notes: '', repos_json: '[]', source: 'test',
    task_last_updated: over.last, content_hash: `h-${over.id}`, now,
  });
}

/**
 * Build a service whose plan-limit snapshot is whatever the test says.
 *
 * `windows` takes `{ five_hour: 96 }` — a used-percentage per window — and is
 * expanded into the snapshot shape the store produces. Passing the percentages
 * directly keeps each test's intent on one line.
 */
function setup(windows, settings, at = NOW.getTime()) {
  const db = openDatabase(':memory:');
  const repo = new TaskRepository(db);
  const now = NOW.toISOString();
  task(repo, { id: 't1', title: 'Broken build', agent: 'Backend Engineer', status: 'Failed', last: now }, now);
  task(repo, { id: 't2', title: 'Needs review', agent: 'Frontend Engineer', status: 'Reviewing', last: now }, now);
  task(repo, { id: 't3', title: 'Old WIP', agent: 'QA Engineer', status: 'Working', last: '2026-07-01T00:00:00.000Z' }, now); // stalled (27d)
  task(repo, { id: 't4', title: 'Fresh WIP', agent: 'DB Admin', status: 'Working', last: '2026-07-27T00:00:00.000Z' }, now); // fresh → not flagged
  task(repo, { id: 't5', title: 'Done thing', agent: 'DevOps Engineer', status: 'Completed', last: now }, now); // no item

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-'));
  const settingsService = { getAll: () => settings || {} };

  const readUsage = () => {
    if (!windows) return { usage: null, stale: true, ageMs: null };
    const built = {};
    for (const [key, usedPercent] of Object.entries(windows)) {
      // A reset four hours out, so `detail` has something to say.
      built[key] = { usedPercent, resetsAt: Math.floor(at / 1000) + 4 * 3600 };
    }
    return { usage: { source: 'stream', at, status: 'allowed', binding: null, windows: built } };
  };

  return new AttentionService(repo, settingsService, dir, readUsage);
}

test('flags failed, review, and stalled — not fresh or completed', () => {
  const s = setup().summary(NOW);
  assert.equal(s.counts.failed, 1);
  assert.equal(s.counts.review, 1);
  assert.equal(s.counts.stalled, 1);
  assert.ok(s.items.every((i) => i.entityId !== 't4' && i.entityId !== 't5'));
});

test('failed is high severity and sorted first', () => {
  const s = setup().summary(NOW);
  assert.equal(s.items[0].kind, 'failed');
  assert.equal(s.items[0].severity, 'high');
  assert.equal(s.counts.high, 1);
});

test('high-severity item when a window is nearly exhausted', () => {
  const s = setup({ seven_day: 96 }).summary(NOW);
  const limit = s.items.find((i) => i.kind === 'limit');
  assert.ok(limit);
  assert.equal(limit.severity, 'high');
  assert.match(limit.title, /weekly/);
  // The figure and the reset, because "approaching your limit" with no number
  // is the kind of alert that gets dismissed without being read.
  assert.match(limit.detail, /96% used/);
  assert.match(limit.detail, /resets in 4h/);
});

test('medium-severity item when a window is merely high', () => {
  const s = setup({ five_hour: 85 }).summary(NOW);
  const limit = s.items.find((i) => i.kind === 'limit');
  assert.equal(limit.severity, 'medium');
  assert.match(limit.title, /Approaching/);
});

test('no limit item below the warn threshold', () => {
  // 40% of a 5-hour window is an ordinary afternoon, not an alert.
  assert.equal(setup({ five_hour: 40, seven_day: 65 }).summary(NOW).counts.limit, 0);
});

test('the warn threshold is configurable', () => {
  const strict = setup({ seven_day: 55 }, { usageWarnPercent: 50 }).summary(NOW);
  assert.equal(strict.counts.limit, 1);
  const relaxed = setup({ seven_day: 55 }, { usageWarnPercent: 90 }).summary(NOW);
  assert.equal(relaxed.counts.limit, 0);
});

test('no usage snapshot yields no limit items, and does not throw', () => {
  /*
   * The state on a fresh app start, and permanently on API-key sessions. It
   * must produce silence rather than a "0% used" item — inventing an all-clear
   * is the failure this whole change was made to stop.
   */
  const s = setup(null).summary(NOW);
  assert.equal(s.counts.limit, 0);
  assert.ok(s.counts.total > 0, 'task items should still be present');
});

test('unknown window kinds are ignored rather than shown by raw key', () => {
  const s = setup({ cinder_cove: 99, seven_day_oauth_apps: 99 }).summary(NOW);
  assert.equal(s.counts.limit, 0);
});

test('per-model weekly windows are labelled, not skipped', () => {
  const s = setup({ seven_day_opus: 97 }).summary(NOW);
  const limit = s.items.find((i) => i.kind === 'limit');
  assert.ok(limit);
  assert.match(limit.title, /Opus/);
});

test('a limit item carries the reading time, not the window start', () => {
  const observedAt = NOW.getTime() - 90_000;
  const s = setup({ seven_day: 99 }, {}, observedAt).summary(NOW);
  const limit = s.items.find((i) => i.kind === 'limit');
  assert.equal(limit.since, new Date(observedAt).toISOString());
});

test('no dollar figure appears anywhere in the queue', () => {
  // The old budget item rendered "$297.28 / $50.00". Nothing should now.
  const s = setup({ five_hour: 99, seven_day: 99 }).summary(NOW);
  for (const item of s.items) {
    assert.ok(!/\$/.test(item.detail || ''), `unexpected $ in: ${item.detail}`);
    assert.ok(!/\$/.test(item.title || ''), `unexpected $ in: ${item.title}`);
  }
});
