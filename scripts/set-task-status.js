#!/usr/bin/env node
/**
 * Change a task's status, from an agent — with one status withheld.
 *
 * AN AGENT MAY NOT COMPLETE ITS OWN WORK.
 *
 * Joel reviews before anything is Done. That is not a preference about
 * process, it is about what the board is for: a task marked Completed is a
 * claim that work was finished and checked, and an agent marking its own work
 * Completed makes the board assert something nobody verified. It has already
 * happened — three tasks were filed, built, and marked Completed inside an
 * hour, one of which shipped a feature reading the wrong data source
 * entirely. The board said Done; the feature did not work.
 *
 * So Completed is refused here. The path for finished work is Reviewing,
 * which puts it at the TOP of the board (see frontend/src/lib/task-order.ts)
 * rather than burying it at the bottom, and then Joel marks it Done from the
 * dashboard or by voice.
 *
 * WHY THIS IS ENFORCED IN CODE RATHER THAN WRITTEN IN AGENTS.md
 *
 * Because instructions have failed at exactly this three times already in
 * this codebase: agents were told to check for an existing task id and picked
 * a duplicate anyway, assistant-sessions.remember() was documented and never
 * called, and the rule about review was stated and ignored. A rule the board
 * enforces cannot be forgotten mid-task. The instruction exists too — this is
 * the half that holds when the instruction is skipped.
 *
 *   node scripts/set-task-status.js --id 34 --status Reviewing
 */
const path = require('path');
const { setTaskStatus, STATUSES } = require('../shared/tasks-write');

/** The one an agent cannot set. Everything else on the board is fair game. */
const RESERVED = 'Completed';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    if (!['id', 'status', 'progress'].includes(name)) {
      throw new Error(`unknown flag --${name} — expected --id, --status, or --progress`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    out[name] = value;
    i += 1;
  }
  return out;
}

function boardPath() {
  const { getConfig } = require('../shared/workspace-config');
  return getConfig()?.paths?.tasksFile || path.join(__dirname, '..', 'data', 'tasks.json');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id || !args.status) {
    console.error(`usage: node scripts/set-task-status.js --id <id> --status <${STATUSES.filter((s) => s !== RESERVED).join('|')}> [--progress <0-100>]`);
    process.exit(2);
  }

  if (args.status === RESERVED) {
    console.error(
      'refused: an agent may not mark a task Completed.\n'
      + 'Set it to Reviewing and hand the work back — say what changed and how to\n'
      + 'test it. Joel marks it Done once he has reviewed it.',
    );
    process.exit(1);
  }

  const progress = args.progress ? Number(args.progress) : null;
  if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
    throw new Error('progress must be a number between 0 and 100');
  }

  const { task, previous } = setTaskStatus(boardPath(), args.id, args.status, progress);
  console.log(`Task ${task.id}: ${previous} -> ${task.status} (${task.progress}%)`);
  console.log(task.title);
  if (task.status === 'Reviewing') {
    console.log('\nIt is at the top of the board now. Tell Joel what to review.');
  }
}

try {
  main();
} catch (err) {
  console.error(`could not update the task: ${err.message}`);
  process.exit(1);
}
