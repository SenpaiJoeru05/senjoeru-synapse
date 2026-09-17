#!/usr/bin/env node
/**
 * File a task on the board, from an agent.
 *
 * WHY THIS EXISTS RATHER THAN "JUST EDIT tasks.json".
 *
 * Editing the board by hand is what agents did before, and it is how two
 * different turns both picked id 30 — one task silently stopped reaching the
 * dashboard. The id has to be computed from the MAX of every id on the board,
 * inside the same read-modify-write that appends the task, and no instruction
 * in a markdown file makes a model do that reliably. shared/tasks-write.js
 * does it structurally; this is the doorway an agent can reach it through.
 *
 * WHY NOT THE HTTP ENDPOINT. POST /api/tasks does the same thing and syncs
 * SQLite immediately, but agents are granted no curl — deliberately, since
 * that would be a general outbound-request capability for the sake of one
 * call. Writing the file directly needs no server running at all; the
 * collector reconciles SQLite on its next poll (15s).
 *
 *   node scripts/file-task.js --title "Fix the thing" --agent backend-engineer \
 *     --repos fsweb --priority High --notes "why it matters"
 *
 * --title is the only required flag. Prints the created task as JSON, so the
 * real assigned id can be reported rather than guessed.
 */
const path = require('path');
const { createTask } = require('../shared/tasks-write');

const FLAGS = ['title', 'agent', 'repos', 'priority', 'status', 'notes', 'eta'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    if (!FLAGS.includes(name)) {
      throw new Error(`unknown flag --${name} — expected one of ${FLAGS.map((f) => `--${f}`).join(', ')}`);
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
  const configured = getConfig()?.paths?.tasksFile;
  // Falling back to this repo's own copy rather than failing: the config is
  // the authority, but a missing key should not stop a task being filed.
  return configured || path.join(__dirname, '..', 'data', 'tasks.json');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // Same rule as set-task-status.js: an agent does not get to declare work
  // done. Filing a task that is already Completed is the obvious way around
  // that, so it is closed here rather than left as the gap.
  if (args.status === 'Completed') {
    console.error(
      'refused: a task cannot be filed as already Completed.\n'
      + 'File it, do the work, then set Reviewing and hand it back to Joel.',
    );
    process.exit(1);
  }

  if (!args.title) {
    console.error('usage: node scripts/file-task.js --title "..." [--agent slug] '
      + '[--repos a,b] [--priority Low|Medium|High] [--status Pending|Working|Reviewing|Completed|Failed] '
      + '[--notes "..."] [--eta "..."]');
    process.exit(2);
  }

  const file = boardPath();
  const { task } = createTask(file, {
    title: args.title,
    assignedAgent: args.agent,
    repos: args.repos ? args.repos.split(',') : [],
    priority: args.priority,
    status: args.status,
    notes: args.notes,
    eta: args.eta,
  });

  console.log(`Filed task ${task.id}: ${task.title}`);
  console.log(JSON.stringify(task, null, 2));
}

try {
  main();
} catch (err) {
  console.error(`could not file the task: ${err.message}`);
  process.exit(1);
}
