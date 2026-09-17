/**
 * The ONE place Synapse writes the task board.
 *
 * A deliberate change of ownership, recorded here because three documents said
 * the opposite before this existed:
 *
 *   docs/architecture-review/05-task-system.md  "Read-only mirror — no way to
 *     create/edit/complete a task from the dashboard; all writes happen in
 *     tasks.json by agents."
 *   docs/architecture-review/12-known-issues.md  the same, listed as a known
 *     limitation.
 *   docs/roadmap/ARCHITECTURE-V2.md              the board is an "authoring
 *     inbox — an external input".
 *
 * Those were right for a dashboard you only look at. They stopped being right
 * when Assistant Mode could be spoken to: asking by voice to mark a task done
 * had to go through Claude, which meant thirteen seconds and subscription
 * quota to change one string in a JSON file — and a model editing the board by
 * hand can mis-target in ways a status change cannot.
 *
 * Kept separate from tasks-board.js so that file's guarantee — "This module
 * never writes it" — stays literally true. One writer, one narrow operation.
 *
 * WHAT THIS DELIBERATELY CANNOT DO: delete a task, or edit a title or notes.
 * Editing existing text stays with the agents.
 *
 * CREATION USED TO BE ON THAT LIST. Commit c6e3d50 considered adding it and
 * refused, on the grounds that "authoring stays with the agents" and that the
 * sync-side duplicate guard already made the real failure — silent data loss —
 * structurally impossible. Both halves of that turned out to be worth less
 * than they read:
 *
 *   - The guard stops a duplicate id from ERASING a task. It does not stop the
 *     duplicate from happening, and a refused task is still a task that never
 *     reaches the dashboard. Loud beats silent; neither beats correct.
 *   - "Authoring stays with the agents" described an authoring path that, in
 *     practice, barely ran. Asked for a feature, nothing filed a task at all
 *     unless the model happened to remember an instruction in a global
 *     markdown file and hand-edit JSON correctly. When it did remember, it
 *     computed the next id by eye — and the ids in this file are not in
 *     ascending order (…9, 10, 11, 1, 2, 3, 4, 12…), so "the last one plus
 *     one" is wrong on this board specifically. That is exactly how two
 *     different turns both chose 30.
 *
 * So id assignment moves here, where it is computed from the max of every id
 * on the board inside the same read-modify-write that appends the task. A
 * caller cannot supply an id; there is no argument for one. That makes a
 * collision impossible at the source rather than detectable downstream.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** The board's vocabulary — collectors/index.js is the other authority on it. */
const STATUSES = ['Pending', 'Working', 'Reviewing', 'Completed', 'Failed'];

/** Every priority currently in use on the real board, and nothing else. */
const PRIORITIES = ['Low', 'Medium', 'High'];

/**
 * Progress implied by a status, applied only where it is unambiguous.
 *
 * Completed means 100 by definition and the dashboard renders a completed task
 * at whatever progress it finds, so leaving it at 40 shows a finished task as
 * two-fifths done. The other statuses say nothing about progress, so they leave
 * whatever the agent recorded alone rather than inventing a number.
 */
function impliedProgress(status, current) {
  if (status === 'Completed') return 100;
  return typeof current === 'number' ? current : 0;
}

function readBoard(filePath) {
  const board = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(board.tasks)) throw new Error('task board has no tasks array');
  return board;
}

/**
 * Same directory, so the rename is a rename and not a copy.
 *
 * Atomic because this is the SECOND writer of this file — the agents are the
 * first, and the collector watches it. A partial write would be read by a
 * watcher mid-flight as a corrupt board.
 */
function writeBoard(filePath, board) {
  const tmp = path.join(
    path.dirname(filePath),
    `.tasks-${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  fs.writeFileSync(tmp, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * The next free id — max of every id on the board, plus one.
 *
 * MAX, not length and not the last entry. The ids in the real file are not in
 * ascending order, so both of the obvious shortcuts return an id that is
 * already taken. Non-numeric ids are skipped rather than rejected: none exist
 * today, and one appearing is not a reason to refuse to file a task.
 */
function nextId(tasks) {
  let max = 0;
  for (const t of tasks) {
    const n = Number(t.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

/** Board convention is a flat array of repo-name strings. */
function normalizeRepos(repos) {
  const list = Array.isArray(repos) ? repos : (repos ? [repos] : []);
  return list.map((r) => String(r).trim()).filter(Boolean);
}

/**
 * Append a new task, with the id assigned here.
 *
 * `fields.id` is REFUSED rather than ignored. Agents are instructed elsewhere
 * to work out the next id themselves, so one will be supplied eventually; a
 * silent override would leave the caller believing its number was used, and
 * the whole point of this function is that the number is not negotiable.
 *
 * Shares readBoard/writeBoard with setTaskStatus, so it inherits the same
 * atomic swap and the same honest residual race: a read-modify-write can lose
 * to an agent writing the same file in the same millisecond.
 */
function createTask(filePath, fields = {}) {
  if (fields.id !== undefined && fields.id !== null && fields.id !== '') {
    throw new Error('id is assigned by the board — do not supply one');
  }

  const title = String(fields.title || '').trim();
  if (!title) throw new Error('title is required');

  const status = fields.status || 'Pending';
  if (!STATUSES.includes(status)) {
    throw new Error(`unknown status "${status}" — expected one of ${STATUSES.join(', ')}`);
  }

  const priority = fields.priority || 'Medium';
  if (!PRIORITIES.includes(priority)) {
    throw new Error(`unknown priority "${priority}" — expected one of ${PRIORITIES.join(', ')}`);
  }

  const board = readBoard(filePath);
  const now = new Date().toISOString();

  const task = {
    id: nextId(board.tasks),
    title,
    assignedAgent: String(fields.assignedAgent || '').trim(),
    repos: normalizeRepos(fields.repos),
    progress: impliedProgress(status, Number(fields.progress) || 0),
    status,
    eta: String(fields.eta || ''),
    priority,
    notes: String(fields.notes || ''),
    lastUpdated: now,
  };

  board.tasks.push(task);
  board.lastUpdated = now;
  writeBoard(filePath, board);

  return { task };
}

/**
 * Read, change one status, write back atomically.
 *
 * Atomic because this is now the SECOND writer of this file — the agents are
 * the first, and the collector watches it. A partial write would be read by a
 * watcher mid-flight as a corrupt board. Writing a temp file in the same
 * directory and renaming makes the swap indivisible; rename across
 * filesystems is not, hence same-directory.
 *
 * The residual risk is honest and worth stating: read-modify-write has a race
 * with an agent writing the same file in the same instant, and the loser's
 * change is lost. The window is milliseconds and the alternative is a lock
 * protocol every agent would have to honour, which is a much larger change
 * than this feature justifies.
 */
function setTaskStatus(filePath, taskId, status) {
  if (!STATUSES.includes(status)) {
    throw new Error(`unknown status "${status}" — expected one of ${STATUSES.join(', ')}`);
  }

  const board = readBoard(filePath);
  const task = board.tasks.find((t) => String(t.id) === String(taskId));
  if (!task) throw new Error(`no task with id ${taskId}`);

  const previous = task.status;
  const now = new Date().toISOString();

  task.status = status;
  task.progress = impliedProgress(status, task.progress);
  // "Done" reads oddly on anything unfinished, so it is set only alongside
  // Completed and cleared back to empty rather than left stale.
  if (status === 'Completed') task.eta = 'Done';
  else if (task.eta === 'Done') task.eta = '';
  task.lastUpdated = now;
  board.lastUpdated = now;

  writeBoard(filePath, board);

  return { task, previous };
}

module.exports = { setTaskStatus, createTask, STATUSES, PRIORITIES };
