/**
 * Tests for TaskSyncService — the Claude tasks.json -> SQLite importer.
 *
 *   cd backend && node --test
 *
 * Focus: append-only history (Option A) — new/changed states each append
 * exactly one snapshot; unchanged re-syncs write nothing; removed tasks are
 * retained with history intact; the lenient parser survives bad escapes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../lib/db');
const { TaskRepository } = require('../repositories/task-repository');
const { TaskSyncService } = require('./task-sync-service');

function tmpBoardPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-board-')), 'tasks.json');
}

function writeBoard(p, tasks, lastUpdated = '2026-07-23T00:00:00.000Z') {
  fs.writeFileSync(p, JSON.stringify({ lastUpdated, source: 'claude-tasks', tasks }), 'utf8');
}

function setup() {
  const db = openDatabase(':memory:');
  const boardPath = tmpBoardPath();
  const svc = new TaskSyncService(db, boardPath);
  const repo = new TaskRepository(db);
  return { db, boardPath, svc, repo };
}

test('initial sync creates tasks and one history row each', () => {
  const { boardPath, svc, repo } = setup();
  writeBoard(boardPath, [
    { id: 'a', title: 'Task A', status: 'Working', progress: 10 },
    { id: 'b', title: 'Task B', status: 'Pending', progress: 0 },
  ]);
  const summary = svc.sync();
  assert.equal(summary.created, 2);
  assert.equal(summary.updated, 0);
  assert.equal(summary.historyWritten, 2);
  assert.equal(repo.getAll().length, 2);
  assert.equal(repo.historyCount('a'), 1);
  assert.equal(repo.historyCount('b'), 1);
});

test('re-syncing an unchanged board writes no new history (idempotent)', () => {
  const { boardPath, svc, repo } = setup();
  writeBoard(boardPath, [{ id: 'a', title: 'Task A', status: 'Working', progress: 10 }]);
  svc.sync();
  const summary = svc.sync();
  assert.equal(summary.created, 0);
  assert.equal(summary.updated, 0);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.historyWritten, 0);
  assert.equal(repo.historyCount('a'), 1); // still just the original snapshot
});

test('changing a task appends exactly one history snapshot', () => {
  const { boardPath, svc, repo } = setup();
  writeBoard(boardPath, [{ id: 'a', title: 'Task A', status: 'Working', progress: 10 }]);
  svc.sync();

  writeBoard(boardPath, [{ id: 'a', title: 'Task A', status: 'Completed', progress: 100 }]);
  const summary = svc.sync();
  assert.equal(summary.updated, 1);
  assert.equal(summary.historyWritten, 1);

  const history = repo.getHistory('a');
  assert.equal(history.length, 2);                    // append-only: old + new
  assert.equal(history[0].status, 'Working');         // oldest first
  assert.equal(history[1].status, 'Completed');
  assert.equal(repo.getById('a').status, 'Completed'); // current row reflects latest
  assert.equal(repo.getById('a').progress, 100);
});

test('a task removed from the board is retained with history intact', () => {
  const { boardPath, svc, repo } = setup();
  writeBoard(boardPath, [
    { id: 'a', title: 'Task A', status: 'Working' },
    { id: 'b', title: 'Task B', status: 'Working' },
  ]);
  svc.sync();

  writeBoard(boardPath, [{ id: 'a', title: 'Task A', status: 'Working' }]); // b removed
  const summary = svc.sync();
  assert.equal(summary.markedAbsent, 1);

  const b = repo.getById('b');
  assert.ok(b, 'removed task still persisted');
  assert.equal(b.present_in_board, 0);
  assert.equal(repo.historyCount('b'), 1); // history preserved
});

test('repos array round-trips through JSON storage', () => {
  const { boardPath, svc, repo } = setup();
  writeBoard(boardPath, [{
    id: 'a', title: 'Multi', status: 'Working',
    repos: [{ name: 'fs-llm-service', branch: 'dev', status: 'Working' }],
  }]);
  svc.sync();
  const stored = JSON.parse(repo.getById('a').repos_json);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, 'fs-llm-service');
  assert.equal(stored[0].branch, 'dev');
});

test('lenient parser imports a board with an invalid JSON escape', () => {
  const { boardPath, svc, repo } = setup();
  // Agents sometimes paste code like `\$queue` into notes — invalid JSON escape.
  const raw = '{"lastUpdated":"x","source":"claude-tasks","tasks":[' +
    '{"id":"a","title":"has bad escape","status":"Working","notes":"php \\$queue here"}]}';
  fs.writeFileSync(boardPath, raw, 'utf8');
  const summary = svc.sync();
  assert.equal(summary.skipped ?? false, false);
  assert.equal(summary.created, 1);
  assert.ok(repo.getById('a'), 'task imported despite bad escape');
});

test('missing board is skipped, SQLite untouched', () => {
  const { svc } = setup(); // boardPath never written
  const summary = svc.sync();
  assert.equal(summary.skipped, true);
});
