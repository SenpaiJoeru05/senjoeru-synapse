/**
 * Tests for automatic project grouping.
 *
 * The point of deriving projects is that a new user gets sensible structure
 * with no configuration at all — so the derivation has to hold up on layouts
 * nobody planned for, not just a tidy one.
 *
 *   node --test backend/lib/workspace-projects.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveProjects } = require('../../shared/workspace-config');

const names = (projects) => projects.map((p) => p.name);
const repos = (projects, name) => projects.find((p) => p.name === name).repositories;

test('repos are grouped by the folder that contains them', () => {
  const projects = deriveProjects([
    'D:\\acme\\web-app',
    'D:\\acme\\chat-service',
    'D:\\personal\\notes-app',
  ], 'Workspace', '');

  assert.deepEqual(names(projects).sort(), ['acme', 'personal']);
  assert.deepEqual(repos(projects, 'acme').sort(), ['chat-service', 'web-app']);
  assert.deepEqual(repos(projects, 'personal'), ['notes-app']);
});

test('windows paths group correctly on any platform', () => {
  // path.dirname only understands the host separator, so this grouped into a
  // single "." bucket on Linux while passing on Windows — the CI failure that
  // a local-only run could never have caught.
  const projects = deriveProjects([
    'D:\\work\\acme\\api',
    'D:\\work\\acme\\web',
    'D:\\work\\side\\blog',
  ], 'Workspace', '');

  assert.deepEqual(names(projects).sort(), ['acme', 'side']);
  assert.deepEqual(repos(projects, 'acme').sort(), ['api', 'web']);
});

test('the biggest project comes first', () => {
  const projects = deriveProjects([
    '/home/dev/solo/one',
    '/home/dev/big/a',
    '/home/dev/big/b',
    '/home/dev/big/c',
  ], 'Workspace', '');

  assert.equal(projects[0].name, 'big');
  assert.equal(projects[0].repositories.length, 3);
});

test('one containing folder means one project, not a pointless tier', () => {
  // A tier that every repo belongs to conveys nothing, so it collapses back to
  // the workspace name rather than inventing a grouping.
  const projects = deriveProjects([
    '/home/dev/work/api',
    '/home/dev/work/web',
  ], "Joel's Workspace", '🧠');

  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "Joel's Workspace");
  assert.deepEqual(projects[0].repositories.sort(), ['api', 'web']);
});

test('a fresh install with no repos still yields one usable project', () => {
  const projects = deriveProjects([], 'Workspace', '');

  assert.equal(projects.length, 1, 'the graph always needs somewhere to hang');
  assert.equal(projects[0].name, 'Workspace');
  assert.deepEqual(projects[0].repositories, []);
});

test('every derived project carries the fields the graph reads', () => {
  const projects = deriveProjects([
    '/a/one/x',
    '/b/two/y',
  ], 'Workspace', '');

  for (const p of projects) {
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.emoji, 'string');
    assert.equal(typeof p.root, 'string');
    assert.ok(Array.isArray(p.repositories));
  }
});
