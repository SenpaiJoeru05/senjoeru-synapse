/**
 * Which CLI sessions belong to Assistant Mode, so Chat can leave them out.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Assistant Mode answers each question with a one-shot `claude -p`, and the
 * CLI writes a transcript per invocation. Chat's conversation list reads every
 * `.jsonl` in the project directory, so after a few voice questions the
 * sidebar filled up with rows titled "You are answering one turn of a spoken
 * conversation" — the grounding preamble, which is the first user message of
 * every one. Eighty of them had accumulated before this was noticed, burying
 * the handful of real Chat conversations.
 *
 * WHY AN ID LIST RATHER THAN MATCHING THE PROMPT TEXT
 *
 * Detecting them by that preamble is the obvious fix and it is wrong twice.
 * It couples the session list to the exact wording of a prompt in
 * `frontend/src/lib/grounding.ts` — reword that and the rows silently come
 * back. And it costs a read of every transcript to filter, which is precisely
 * what `list()` avoids: it reads titles only for the rows it will show,
 * because this directory holds a 23MB transcript and will hold more.
 *
 * Recording the id at spawn time is exact, costs nothing to check, and cannot
 * drift from the prompt.
 *
 * WHY ASSISTANT MODE IS NOT GIVEN ONE PERSISTENT SESSION INSTEAD
 *
 * That would collapse the files to one, and it is the wrong trade. A resumed
 * session carries its whole history into every later turn, so a voice
 * conversation would grow without limit — while Assistant Mode only ever
 * needs a turn or two of context, which `grounding.ts` already supplies by
 * re-sending four exchanges. It would also spend more with each question for
 * context nobody asked about. One-shot is deliberate; the leak into Chat's
 * list was the bug.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'assistant-sessions.json');

/**
 * Enough to cover any plausible backlog of listed rows, bounded so the file
 * cannot grow forever. Chat shows a few dozen; anything older than this has
 * long since dropped off the bottom of the list.
 */
const MAX_REMEMBERED = 2000;

/** Mirrored in memory so a list render never waits on the disk. */
let cached = null;

function load() {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cached = Array.isArray(parsed?.ids) ? parsed.ids : [];
  } catch {
    // Never written, unreadable, or malformed. An empty list is the safe
    // answer: it means nothing is hidden, which is visible and fixable —
    // the opposite failure would hide real conversations.
    cached = [];
  }
  return cached;
}

function persist(ids) {
  const tmp = `${FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ ids }, null, 2));
    fs.renameSync(tmp, FILE);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
  }
}

/** Note that `id` is an Assistant Mode session. Newest last. */
function remember(id) {
  const clean = String(id || '').trim();
  if (!clean) return;
  const ids = load();
  if (ids.includes(clean)) return;
  ids.push(clean);
  // Drop the oldest rather than the newest — the recent ones are the ones
  // still appearing in Chat's list.
  if (ids.length > MAX_REMEMBERED) ids.splice(0, ids.length - MAX_REMEMBERED);
  cached = ids;
  persist(ids);
}

/** Record several at once — used by the one-off backfill of existing files. */
function rememberAll(list) {
  const ids = load();
  let added = 0;
  for (const raw of list || []) {
    const clean = String(raw || '').trim();
    if (!clean || ids.includes(clean)) continue;
    ids.push(clean);
    added += 1;
  }
  if (!added) return 0;
  if (ids.length > MAX_REMEMBERED) ids.splice(0, ids.length - MAX_REMEMBERED);
  cached = ids;
  persist(ids);
  return added;
}

/** The set Chat's list excludes. */
function ids() {
  return new Set(load());
}

module.exports = { remember, rememberAll, ids, FILE };
