/**
 * Tests for NotesService + BookmarkService.  cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../lib/db');
const { NotesRepository, BookmarkRepository } = require('../repositories/knowledge-repository');
const { NotesService, BookmarkService } = require('./knowledge-service');

function notes() { return new NotesService(new NotesRepository(openDatabase(':memory:'))); }

test('note create requires a title', () => {
  assert.throws(() => notes().create({ body: 'x' }), /title is required/);
});

test('note create → get → update → delete', () => {
  const svc = notes();
  const n = svc.create({ title: 'Deadlock fix', body: 'roll back first', category: 'gotcha' });
  assert.ok(n.id);
  assert.equal(svc.get(n.id).title, 'Deadlock fix');

  const up = svc.update(n.id, { body: 'roll back before retry' });
  assert.equal(up.body, 'roll back before retry');
  assert.equal(up.title, 'Deadlock fix'); // unchanged field preserved

  svc.remove(n.id);
  assert.equal(svc.get(n.id), undefined);
  assert.equal(svc.list().length, 0);
});

test('updating / deleting a missing note throws', () => {
  const svc = notes();
  assert.throws(() => svc.update(999, { title: 'x' }), /not found/);
  assert.throws(() => svc.remove(999), /not found/);
});

test('bookmarks: create requires label, list + remove work', () => {
  const svc = new BookmarkService(new BookmarkRepository(openDatabase(':memory:')));
  assert.throws(() => svc.create({ url: 'x' }), /label is required/);
  const b = svc.create({ label: 'PR #451', url: 'https://example/451' });
  assert.equal(svc.list().length, 1);
  svc.remove(b.id);
  assert.equal(svc.list().length, 0);
});
