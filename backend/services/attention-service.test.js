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

function setup(costs, settings) {
  const db = openDatabase(':memory:');
  const repo = new TaskRepository(db);
  const now = NOW.toISOString();
  task(repo, { id: 't1', title: 'Broken build', agent: 'Backend Engineer', status: 'Failed', last: now }, now);
  task(repo, { id: 't2', title: 'Needs review', agent: 'Frontend Engineer', status: 'Reviewing', last: now }, now);
  task(repo, { id: 't3', title: 'Old WIP', agent: 'QA Engineer', status: 'Working', last: '2026-07-01T00:00:00.000Z' }, now); // stalled (27d)
  task(repo, { id: 't4', title: 'Fresh WIP', agent: 'DB Admin', status: 'Working', last: '2026-07-27T00:00:00.000Z' }, now); // fresh → not flagged
  task(repo, { id: 't5', title: 'Done thing', agent: 'DevOps Engineer', status: 'Completed', last: now }, now); // no item

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-'));
  if (costs) fs.writeJsonSync(path.join(dir, 'costs.json'), costs);
  const settingsService = { getAll: () => settings || { hourlyBudget: 5, weeklyBudget: 200 } };
  return new AttentionService(repo, settingsService, dir);
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

test('budget item when weekly spend over limit', () => {
  const s = setup({ weekly: 210, thisHour: 1 }, { hourlyBudget: 5, weeklyBudget: 200 }).summary(NOW);
  const budget = s.items.find((i) => i.kind === 'budget');
  assert.ok(budget);
  assert.equal(budget.severity, 'high');
  assert.match(budget.title, /weekly/);
});

test('no budget item when under 90% or no limit set', () => {
  const under = setup({ weekly: 100, thisHour: 1 }, { hourlyBudget: 5, weeklyBudget: 200 }).summary(NOW);
  assert.equal(under.counts.budget, 0);
  const noLimit = setup({ weekly: 999 }, { hourlyBudget: 0, weeklyBudget: 0 }).summary(NOW);
  assert.equal(noLimit.counts.budget, 0);
});
