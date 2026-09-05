/**
 * Tests for ObservationService — persisting git/session/agent observation to
 * SQLite as history.  cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../lib/db');
const { ObservationRepository } = require('../repositories/observation-repository');
const { ObservationService } = require('./observation-service');

function setup() {
  const db = openDatabase(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-obs-'));
  const svc = new ObservationService(db, dir);
  const repo = new ObservationRepository(db);
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj), 'utf8');
  return { db, dir, svc, repo, write };
}

test('repo snapshots append only on change (idempotent otherwise)', () => {
  const { svc, repo, write } = setup();
  write('git.json', { repos: [{ name: 'chat-service', branch: 'dev', ahead: 0, behind: 0, modified: ['a'], staged: [] }] });

  assert.equal(svc.snapshotAll().repoChanges, 1);
  assert.equal(svc.snapshotAll().repoChanges, 0);           // unchanged → no new row
  assert.equal(repo.getRepoSnapshots('chat-service').length, 1);

  write('git.json', { repos: [{ name: 'chat-service', branch: 'main', ahead: 1, behind: 0, modified: [], staged: [] }] });
  assert.equal(svc.snapshotAll().repoChanges, 1);           // changed → new row
  assert.equal(repo.getRepoSnapshots('chat-service').length, 2);
});

test('sessions upsert while active and are marked ended when gone', () => {
  const { svc, repo, write } = setup();
  write('sessions.json', { activeSessions: [
    { sessionId: 's1', pid: 111, cwd: 'd:\\acme\\chat-service', kind: 'interactive', version: '2.1', startedAt: 1 },
    { sessionId: 's2', pid: 222, cwd: 'd:\\acme\\dashboard' },
  ] });
  let r = svc.snapshotAll();
  assert.equal(r.sessionsSeen, 2);
  assert.equal(r.sessionsEnded, 0);
  assert.equal(repo.getSessions().length, 2);

  // s2 disappears → marked ended; s1 stays active.
  write('sessions.json', { activeSessions: [{ sessionId: 's1', pid: 111, cwd: 'd:\\acme\\chat-service' }] });
  r = svc.snapshotAll();
  assert.equal(r.sessionsEnded, 1);
  const sessions = Object.fromEntries(repo.getSessions().map((s) => [s.session_id, s]));
  assert.equal(sessions.s1.active, 1);
  assert.equal(sessions.s2.active, 0);
  assert.ok(sessions.s2.ended_at, 's2 has an ended_at');
  assert.equal(sessions.s1.repo, 'chat-service'); // derived from cwd
});

test('agent activity appends only on state change', () => {
  const { svc, repo, write } = setup();
  write('agents.json', { agents: [
    { name: 'Backend Engineer', status: 'Working', activeCwd: 'd:\\acme\\web-app' },
    { name: 'QA Engineer', status: 'Idle', activeCwd: null },
  ] });
  assert.equal(svc.snapshotAll().agentChanges, 2);
  assert.equal(svc.snapshotAll().agentChanges, 0);          // unchanged

  write('agents.json', { agents: [
    { name: 'Backend Engineer', status: 'Idle', activeCwd: null },   // changed
    { name: 'QA Engineer', status: 'Idle', activeCwd: null },        // same
  ] });
  assert.equal(svc.snapshotAll().agentChanges, 1);
  assert.equal(repo.getAgentActivity('Backend Engineer').length, 2);
});

test('missing metrics files are handled (no throw, zero changes)', () => {
  const { svc } = setup(); // no files written
  const r = svc.snapshotAll();
  assert.equal(r.repoChanges, 0);
  assert.equal(r.sessionsSeen, 0);
  assert.equal(r.agentChanges, 0);
});
