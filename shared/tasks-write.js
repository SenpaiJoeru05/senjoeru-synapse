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
 * WHAT THIS DELIBERATELY CANNOT DO: create a task, delete one, or edit a title
 * or notes. Authoring stays with the agents. The only change permitted is the
 * status of a task that already exists, which is the whole of what a voice
 * command needs and the smallest surface that cannot corrupt someone's work.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/** The board's vocabulary — collectors/index.js is the other authority on it. */
const STATUSES = ['Pending', 'Working', 'Reviewing', 'Completed', 'Failed'];

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

  const raw = fs.readFileSync(filePath, 'utf8');
  const board = JSON.parse(raw);
  if (!Array.isArray(board.tasks)) throw new Error('task board has no tasks array');

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

  // Same directory, so the rename is a rename and not a copy.
  const tmp = path.join(
    path.dirname(filePath),
    `.tasks-${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  fs.writeFileSync(tmp, `${JSON.stringify(board, null, 2)}${os.EOL === '\r\n' ? '\n' : '\n'}`, 'utf8');
  fs.renameSync(tmp, filePath);

  return { task, previous };
}

module.exports = { setTaskStatus, STATUSES };
