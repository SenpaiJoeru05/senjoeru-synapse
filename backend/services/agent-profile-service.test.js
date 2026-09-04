/**
 * Tests for AgentProfileService — importing agent personas into SQLite.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../lib/db');
const { AgentProfileRepository } = require('../repositories/agent-profile-repository');
const { AgentProfileService } = require('./agent-profile-service');

function setup(agents) {
  const db = openDatabase(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-prof-'));
  fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify({ agents }), 'utf8');
  const repo = new AgentProfileRepository(db);
  const svc = new AgentProfileService(repo, dir);
  return { db, dir, repo, svc };
}

test('sync imports personas keyed by slug and is idempotent', () => {
  const { repo, svc } = setup([
    { slug: 'backend-engineer', name: 'Backend Engineer', displayName: 'Miguel Santos', title: 'Senior Backend Engineer', model: 'sonnet', currentTask: 'server-side code' },
    { slug: 'cs-comms-writer', name: 'CS Comms Writer', displayName: 'Camille Ramos', title: 'Communications Writer', model: 'haiku', currentTask: 'team comms' },
  ]);
  assert.equal(svc.sync().synced, 2);
  assert.equal(svc.sync().synced, 2);          // idempotent — still upserts, no dupes
  assert.equal(repo.getAll().length, 2);

  const miguel = repo.getBySlug('backend-engineer');
  assert.equal(miguel.display_name, 'Miguel Santos');
  assert.equal(miguel.title, 'Senior Backend Engineer');
  assert.equal(miguel.role_name, 'Backend Engineer');
  assert.equal(miguel.model, 'sonnet');
});

test('updates persona fields on change', () => {
  const { repo, svc, dir } = setup([
    { slug: 'qa-engineer', name: 'QA Engineer', displayName: 'Ethan Dela Cruz', title: 'QA Engineer', model: 'sonnet' },
  ]);
  svc.sync();
  fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify({ agents: [
    { slug: 'qa-engineer', name: 'QA Engineer', displayName: 'Ethan Dela Cruz', title: 'QA Automation Engineer', model: 'sonnet' },
  ] }), 'utf8');
  svc.sync();
  assert.equal(repo.getBySlug('qa-engineer').title, 'QA Automation Engineer');
  assert.equal(repo.getAll().length, 1); // no duplicate
});

test('falls back to a slugified name when slug is absent (older agents.json)', () => {
  const { repo, svc } = setup([{ name: 'Security Reviewer', displayName: 'Lucas Fernandez', title: 'Security Reviewer' }]);
  svc.sync();
  assert.ok(repo.getBySlug('security-reviewer'), 'slugified from role name');
});

test('missing agents.json is handled (0 synced, no throw)', () => {
  const { svc, dir } = setup([]);
  fs.rmSync(path.join(dir, 'agents.json'));
  assert.equal(svc.sync().synced, 0);
});
