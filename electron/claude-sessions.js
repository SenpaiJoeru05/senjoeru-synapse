/**
 * Reading the Claude Code CLI's own conversation store.
 *
 * Chat moved onto the CLI and its session list did not: the sidebar reads
 * OpenCode sessions, and a CLI conversation is not one. So a conversation was
 * being saved and then made unreachable — you could talk to it today and never
 * find it again tomorrow, which is worse than not saving it, because you would
 * assume it was there.
 *
 * The CLI keeps one JSONL file per session under a per-project directory:
 *
 *   ~/.claude/projects/<slug>/<session-uuid>.jsonl
 *
 * Read-only, deliberately. This is another tool's store and the app has no
 * business writing it — the CLI owns the format and changes it when it likes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Long enough for a sidebar, short enough not to walk a year of history. */
const MAX_SESSIONS = 40;

/** A transcript larger than this is not read for a title; mtime will do. */
const MAX_TITLE_BYTES = 2 * 1024 * 1024;

/**
 * The directory name the CLI derives from a working directory.
 *
 * Every character that is not alphanumeric becomes a dash, one for one — NOT
 * collapsed. `D:\Personal Works\senjoeru-synapse` becomes
 * `D--Personal-Works-senjoeru-synapse`, and the doubled dash is the drive
 * colon and the first separator each contributing their own. A collapsing
 * regex produces `D-Personal-Works-senjoeru-synapse`, which matches no
 * directory at all and would have returned an empty list forever.
 */
function slugFor(dir) {
  return String(dir).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Where this project's transcripts live, or null.
 *
 * Falls back to matching on the repository's own folder name, because the
 * slug rule belongs to the CLI and could change under us. Guessing wrong then
 * degrades to "no sessions" rather than to the wrong project's sessions.
 */
function sessionDir(projectDir) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) return null;

  const exact = path.join(root, slugFor(projectDir));
  if (fs.existsSync(exact)) return exact;

  const base = slugFor(path.basename(projectDir));
  try {
    const match = fs.readdirSync(root).find((d) => d.endsWith(base));
    return match ? path.join(root, match) : null;
  } catch {
    return null;
  }
}

/**
 * The first thing the user actually said, for a title.
 *
 * A transcript opens with setting and queue-operation records that carry no
 * text, so the first line is never the title — this walks to the first entry
 * with role `user`. Content arrives either as a plain string or as an array of
 * blocks depending on how the turn was sent, so both shapes are handled.
 *
 * Command-style turns are skipped: an opening `<command-name>` or a bare
 * `Read <path>` is what a tool invocation looks like in the log, and titling a
 * conversation with it tells you nothing about what it was for.
 */
function titleFrom(file) {
  let raw;
  try {
    if (fs.statSync(file).size > MAX_TITLE_BYTES) return null;
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.message?.role !== 'user') continue;

    const content = entry.message.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('')
        : '';

    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || clean.startsWith('<')) continue;
    return clean.slice(0, 80);
  }
  return null;
}

/**
 * Conversations for this project, newest first.
 *
 * Ordered by mtime rather than by anything inside the file: it is the one
 * signal that is cheap, always present, and actually means "last used".
 */
function list(projectDir) {
  const dir = sessionDir(projectDir);
  if (!dir) return [];

  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const rows = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    // A transcript with nothing in it is a session that was opened and
    // abandoned; listing it is noise.
    if (stat.size < 2) continue;
    rows.push({ id: path.basename(f, '.jsonl'), updated: stat.mtimeMs, bytes: stat.size });
  }

  rows.sort((a, b) => b.updated - a.updated);
  // Titles are read only for the rows that will be shown — reading every
  // transcript to render forty of them is the difference between instant and
  // noticeable once this directory has a few hundred files in it.
  return rows.slice(0, MAX_SESSIONS).map((r) => ({
    ...r,
    title: titleFrom(path.join(dir, `${r.id}.jsonl`)) || 'Untitled conversation',
  }));
}

/**
 * Replay one conversation as alternating turns.
 *
 * Tool calls are summarised rather than replayed in full: the log holds every
 * argument and every result, and a restored transcript that dumps file
 * contents back into the view is unreadable. The counts are what you want when
 * skimming an old conversation.
 */
function read(projectDir, sessionId) {
  /*
   * Validated FIRST, before anything can return early.
   *
   * This check originally sat after the `if (!dir) return` above it, so on any
   * machine where the session directory did not exist — a fresh checkout, or
   * the slug rule changing — a traversal attempt returned an empty result
   * instead of being rejected. It looked safe in testing for the worst reason:
   * the guard was never reached, so it could not fail.
   *
   * The id is interpolated into a filesystem path, so it must be a plain uuid
   * and nothing else.
   */
  if (!/^[0-9a-fA-F-]{8,64}$/.test(String(sessionId))) {
    throw new Error('invalid session id');
  }

  const dir = sessionDir(projectDir);
  if (!dir) return { turns: [] };

  const file = path.join(dir, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return { turns: [] };

  const turns = [];
  let pendingTools = [];

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const role = entry?.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const content = entry.message.content;
    const blocks = Array.isArray(content) ? content : [];
    const text = typeof content === 'string'
      ? content
      : blocks.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('');

    for (const b of blocks) {
      if (b?.type === 'tool_use') pendingTools.push({ name: b.name, input: b.input });
    }

    const clean = String(text).trim();
    // A user entry that is only a tool RESULT is bookkeeping, not something
    // the person said, and showing it as their message is confusing.
    if (!clean || clean.startsWith('<')) continue;
    if (role === 'user' && blocks.some((b) => b?.type === 'tool_result')) continue;

    turns.push({
      role,
      text: clean,
      ...(role === 'assistant' && pendingTools.length ? { tools: pendingTools } : {}),
    });
    if (role === 'assistant') pendingTools = [];
  }

  return { turns };
}

module.exports = { list, read, slugFor, sessionDir };
