/**
 * Tests for SearchService — FTS5 (or LIKE fallback) over all knowledge sources.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../lib/db');
const { NotesRepository, DocIndexRepository } = require('../repositories/knowledge-repository');
const { TaskRepository } = require('../repositories/task-repository');
const { AgentMemoryRepository } = require('../repositories/agent-memory-repository');
const { AnalyticsRepository } = require('../repositories/analytics-repository');
const { SearchService } = require('./search-service');

function seeded() {
  const db = openDatabase(':memory:');
  const now = new Date().toISOString();
  new NotesRepository(db).insert({ title: 'Deadlock fix', body: 'roll back the txn before retry', category: 'gotcha', tags: null, now });
  new DocIndexRepository(db).upsert({ repo: 'fsweb', rel_path: 'docs/refunds.md', title: 'Refund flow', headings: 'refund policy', size: 10, now });
  new TaskRepository(db).upsert({ id: 'pay1', title: 'Payment confirmation flow', assigned_agent: 'Miguel Santos', status: 'Working', progress: 0, priority: 'High', eta: 'x', notes: 'gcash payout', repos_json: '[]', source: 'claude-tasks', task_last_updated: now, content_hash: 'h', now });
  new AgentMemoryRepository(db).upsert({ slug: 'backend-engineer', content: 'deadlock: roll back before retry', char_count: 30, now });
  new AnalyticsRepository(db).insertExecutionIfNew({ event_type: 'git_commit', entity_id: 'fsweb', title: 'fix deadlock retry', detail: '', dedupe_key: 'commit:fsweb:x', occurred_at: now, now });
  return new SearchService(db);
}

test('search finds matches across sources', () => {
  const svc = seeded();
  const r = svc.search('deadlock');
  assert.ok(['fts5', 'like'].includes(r.engine));
  const kinds = new Set(r.results.map((x) => x.kind));
  assert.ok(r.results.length >= 2, 'deadlock appears in note + memory + event');
  assert.ok(kinds.has('note') || kinds.has('memory') || kinds.has('event'));
});

test('search matches a doc by title/headings', () => {
  const r = seeded().search('refund');
  assert.ok(r.results.some((x) => x.kind === 'doc'));
});

test('kind filter restricts results', () => {
  const r = seeded().search('deadlock', { kind: 'note' });
  assert.ok(r.results.every((x) => x.kind === 'note'));
});

test('empty query returns no results (no crash)', () => {
  const r = seeded().search('   ');
  assert.deepEqual(r.results, []);
});
