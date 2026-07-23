/**
 * Tests for the Phase-1 relational core + settings services.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../lib/db');
const { WorkspaceRepository } = require('../repositories/workspace-repository');
const { ProjectRepository } = require('../repositories/project-repository');
const { RepositoryRepository } = require('../repositories/repository-repository');
const { SettingsRepository } = require('../repositories/settings-repository');
const { WorkspaceService } = require('./workspace-service');
const { ProjectService } = require('./project-service');
const { RepositoryService } = require('./repository-service');
const { SettingsService } = require('./settings-service');

function services() {
  const db = openDatabase(':memory:');
  return {
    db,
    workspaces: new WorkspaceService(new WorkspaceRepository(db)),
    projects: new ProjectService(new ProjectRepository(db)),
    repos: new RepositoryService(new RepositoryRepository(db)),
    settingsRepo: new SettingsRepository(db),
  };
}

/* ── workspaces ─────────────────────────────────────────────────────── */

test('ensureDefault creates exactly one default workspace (idempotent)', () => {
  const { workspaces } = services();
  const a = workspaces.ensureDefault();
  const b = workspaces.ensureDefault();
  assert.equal(a.id, b.id);
  assert.equal(a.is_default, 1);
  assert.equal(workspaces.list().length, 1);
});

test('duplicate workspace name is rejected', () => {
  const { workspaces } = services();
  workspaces.create({ name: 'Client Work' });
  assert.throws(() => workspaces.create({ name: 'Client Work' }), /already exists/);
});

/* ── projects ───────────────────────────────────────────────────────── */

test('project is created under a workspace and archived', () => {
  const { workspaces, projects } = services();
  const ws = workspaces.ensureDefault();
  const p = projects.create({ workspaceId: ws.id, name: 'FlowerStorePH', description: 'CS platform' });
  assert.equal(p.status, 'active');
  assert.equal(projects.listByWorkspace(ws.id).length, 1);
  const archived = projects.archive(p.id);
  assert.equal(archived.status, 'archived');
});

test('project requires a name and workspaceId', () => {
  const { workspaces, projects } = services();
  const ws = workspaces.ensureDefault();
  assert.throws(() => projects.create({ workspaceId: ws.id }), /name is required/);
  assert.throws(() => projects.create({ name: 'X' }), /workspaceId is required/);
});

/* ── repositories ───────────────────────────────────────────────────── */

test('register is idempotent by name+path (updates, never duplicates)', () => {
  const { workspaces, projects, repos } = services();
  const ws = workspaces.ensureDefault();
  const p = projects.create({ workspaceId: ws.id, name: 'FlowerStorePH' });

  const r1 = repos.register({ projectId: p.id, name: 'fs-llm-service', path: 'd:/FlowerStorePH/fs-llm-service', branch: 'dev' });
  const r2 = repos.register({ projectId: p.id, name: 'fs-llm-service', path: 'd:/FlowerStorePH/fs-llm-service', branch: 'main' });
  assert.equal(r1.id, r2.id);              // same row
  assert.equal(r2.branch, 'main');         // updated
  assert.equal(repos.listByProject(p.id).length, 1);
});

/* ── settings ───────────────────────────────────────────────────────── */

test('settings default when empty, and save merges + coerces', () => {
  const { settingsRepo } = services();
  const svc = new SettingsService(settingsRepo, null); // no mirror file
  const defaults = svc.getAll();
  assert.equal(defaults.pollInterval, 30);
  assert.equal(Array.isArray(defaults.repositories), true);

  const saved = svc.save({ pollInterval: 2, repositories: 'nope', hourlyBudget: 9 });
  assert.equal(saved.pollInterval, 5);       // coerced up to the 5s minimum
  assert.deepEqual(saved.repositories, []);   // non-array coerced to []
  assert.equal(saved.hourlyBudget, 9);        // preserved
  assert.equal(svc.getAll().hourlyBudget, 9); // persisted
});

test('save mirrors settings to config.json for the collector', () => {
  const { settingsRepo } = services();
  const mirror = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-cfg-')), 'config.json');
  const svc = new SettingsService(settingsRepo, mirror);
  svc.save({ pollInterval: 15, repositories: ['d:/x/repo'] });

  const written = JSON.parse(fs.readFileSync(mirror, 'utf8'));
  assert.equal(written.pollInterval, 15);
  assert.deepEqual(written.repositories, ['d:/x/repo']);
  assert.ok(written.lastUpdated, 'mirror carries a lastUpdated timestamp');
});

test('seedFromConfigIfEmpty imports an existing config.json once', () => {
  const { settingsRepo } = services();
  const mirror = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-cfg-')), 'config.json');
  fs.writeFileSync(mirror, JSON.stringify({ pollInterval: 7, notifications: true, lastUpdated: 'x' }), 'utf8');

  const svc = new SettingsService(settingsRepo, mirror);
  assert.equal(svc.seedFromConfigIfEmpty(), true);
  assert.equal(svc.seedFromConfigIfEmpty(), false); // only seeds once

  const all = svc.getAll();
  assert.equal(all.pollInterval, 7);
  assert.equal(all.notifications, true);
  assert.equal(all.lastUpdated, undefined); // not a setting
});
