const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createTask, setTaskStatus, STATUSES, PRIORITIES } = require('./tasks-write');

/** A throwaway board file, so no test ever touches the real one. */
function board(tasks = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-write-'));
  const file = path.join(dir, 'tasks.json');
  fs.writeFileSync(file, JSON.stringify({ lastUpdated: '2020-01-01T00:00:00.000Z', tasks }, null, 2));
  return file;
}
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('createTask assigns the next id and appends a full board-shaped task', () => {
  const file = board([{ id: '1', title: 'existing', status: 'Pending' }]);
  const { task } = createTask(file, { title: 'New thing' });

  assert.equal(task.id, '2');
  assert.equal(task.title, 'New thing');
  assert.deepEqual(Object.keys(task), [
    'id', 'title', 'assignedAgent', 'repos', 'progress',
    'status', 'eta', 'priority', 'notes', 'lastUpdated',
  ]);

  const after = read(file);
  assert.equal(after.tasks.length, 2, 'appended, nothing replaced');
  assert.equal(after.lastUpdated, task.lastUpdated, 'board timestamp moves with it');
});

/**
 * The regression this function exists for. Ids on the real board are out of
 * order, so "last entry plus one" and "length plus one" both return an id that
 * is already taken — which is how two turns independently chose 30 and one
 * task stopped reaching the dashboard.
 */
test('the next id comes from the MAX id, not the last entry or the count', () => {
  const file = board([
    { id: '9' }, { id: '10' }, { id: '11' },
    { id: '1' }, { id: '2' }, { id: '3' }, { id: '4' },
  ]);
  const { task } = createTask(file, { title: 'after an out-of-order board' });

  assert.equal(task.id, '12', 'max+1 — not "4"+1 and not length+1');
  const ids = read(file).tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate id on the board');
});

test('a caller cannot supply an id — it is refused, not silently overridden', () => {
  const file = board([{ id: '30', title: 'already here' }]);
  assert.throws(() => createTask(file, { title: 'x', id: '30' }), /do not supply one/);
  assert.throws(() => createTask(file, { title: 'x', id: '99' }), /do not supply one/);
  assert.equal(read(file).tasks.length, 1, 'a refused create writes nothing');
});

test('an empty board starts at 1, and a non-numeric id is skipped not fatal', () => {
  assert.equal(createTask(board([]), { title: 'first' }).task.id, '1');
  assert.equal(createTask(board([{ id: 'legacy-abc' }]), { title: 'x' }).task.id, '1');
  assert.equal(createTask(board([{ id: 'legacy-abc' }, { id: '7' }]), { title: 'x' }).task.id, '8');
});

test('title is required and trimmed', () => {
  const file = board();
  assert.throws(() => createTask(file, {}), /title is required/);
  assert.throws(() => createTask(file, { title: '   ' }), /title is required/);
  assert.equal(createTask(file, { title: '  spaced  ' }).task.title, 'spaced');
});

test('status and priority must be board vocabulary, and default sensibly', () => {
  const file = board();
  const { task } = createTask(file, { title: 'defaults' });
  assert.equal(task.status, 'Pending');
  assert.equal(task.priority, 'Medium');

  assert.throws(() => createTask(file, { title: 'x', status: 'InProgress' }), /unknown status/);
  assert.throws(() => createTask(file, { title: 'x', priority: 'Urgent' }), /unknown priority/);

  // Everything the board accepts is accepted here.
  for (const s of STATUSES) assert.equal(createTask(file, { title: s, status: s }).task.status, s);
  for (const p of PRIORITIES) assert.equal(createTask(file, { title: p, priority: p }).task.priority, p);
});

test('created Completed implies 100 progress, matching setTaskStatus', () => {
  const file = board();
  assert.equal(createTask(file, { title: 'done', status: 'Completed', progress: 40 }).task.progress, 100);
  assert.equal(createTask(file, { title: 'part', status: 'Working', progress: 40 }).task.progress, 40);
  assert.equal(createTask(file, { title: 'none', status: 'Working' }).task.progress, 0);
});

test('repos normalize to a flat array of non-empty name strings', () => {
  const file = board();
  assert.deepEqual(createTask(file, { title: 'a', repos: 'fsweb' }).task.repos, ['fsweb']);
  assert.deepEqual(createTask(file, { title: 'b', repos: [' fsweb ', ''] }).task.repos, ['fsweb']);
  assert.deepEqual(createTask(file, { title: 'c' }).task.repos, []);
});

test('createTask and setTaskStatus compose on the same file', () => {
  const file = board();
  const { task } = createTask(file, { title: 'round trip', status: 'Pending' });
  const { task: updated, previous } = setTaskStatus(file, task.id, 'Completed');

  assert.equal(previous, 'Pending');
  assert.equal(updated.status, 'Completed');
  assert.equal(updated.progress, 100);
  assert.equal(updated.eta, 'Done');
  assert.equal(read(file).tasks.length, 1, 'still one task — updated, not re-added');
});

test('a malformed board is refused rather than overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-write-'));
  const file = path.join(dir, 'tasks.json');
  fs.writeFileSync(file, JSON.stringify({ lastUpdated: 'x' }));
  assert.throws(() => createTask(file, { title: 'x' }), /no tasks array/);
  assert.equal(read(file).tasks, undefined, 'left exactly as found');
});
