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
  const titles = readTitles();
  return rows.slice(0, MAX_SESSIONS).map((r) => ({
    ...r,
    // A title the user set wins over the derived one, and `renamed` lets the
    // UI show which is which — otherwise clearing a rename looks broken,
    // because a derived title appears where a set one was.
    title: titles[r.id] || titleFrom(path.join(dir, `${r.id}.jsonl`)) || 'Untitled conversation',
    renamed: Boolean(titles[r.id]),
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

/* ── titles and removal ───────────────────────────────────────────────────── */

/**
 * Titles the user has set, kept in this app's own store.
 *
 * The CLI transcripts carry no title field — the sidebar derives one from the
 * first message — so a rename has nowhere to live in that format. Writing one
 * in would mean editing another tool's data store, which this module
 * deliberately does not do. A small file beside the app's other local state is
 * the honest place for it.
 */
const TITLES_FILE = path.join(__dirname, '..', 'data', 'chat-titles.json');

function readTitles() {
  try {
    const raw = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** A uuid and nothing else — this value reaches the filesystem. */
const VALID_ID = /^[0-9a-fA-F-]{8,64}$/;

function assertId(sessionId) {
  if (!VALID_ID.test(String(sessionId))) throw new Error('invalid session id');
}

/**
 * Set or clear a title. An empty string clears it, restoring the derived one.
 *
 * Validated before touching anything, for the reason the read path had to be
 * fixed: a guard placed after an early return is a guard that never runs.
 */
function rename(sessionId, title) {
  assertId(sessionId);
  const titles = readTitles();
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (clean) titles[sessionId] = clean;
  else delete titles[sessionId];

  fs.mkdirSync(path.dirname(TITLES_FILE), { recursive: true });
  fs.writeFileSync(TITLES_FILE, `${JSON.stringify(titles, null, 2)}\n`, 'utf8');
  return { id: sessionId, title: clean || null };
}

/**
 * Delete a conversation.
 *
 * This is the one place the module writes to the CLI's store, and it only ever
 * unlinks a file whose name it has validated as a uuid and confirmed lives
 * inside the resolved session directory. The realpath check is not paranoia
 * about the regex — it is what makes the guarantee hold even if the id pattern
 * is ever loosened.
 */
function remove(sessionId) {
  assertId(sessionId);
  const dir = sessionDir(path.join(__dirname, '..'));
  if (!dir) return { removed: false, reason: 'no session directory' };

  const file = path.join(dir, `${sessionId}.jsonl`);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('refusing to delete outside the session directory');
  }
  if (!fs.existsSync(resolved)) return { removed: false, reason: 'not found' };

  fs.unlinkSync(resolved);
  // Drop any title with it, or a renamed-then-deleted conversation would leave
  // an orphan entry that resurfaces if the CLI ever reuses the id.
  const titles = readTitles();
  if (titles[sessionId]) {
    delete titles[sessionId];
    fs.writeFileSync(TITLES_FILE, `${JSON.stringify(titles, null, 2)}\n`, 'utf8');
  }
  return { removed: true };
}

/* ── search ───────────────────────────────────────────────────────────────── */

/** Enough hits to be useful, few enough to render. */
const MAX_HITS = 40;

/**
 * Find a phrase across stored conversations.
 *
 * Searches the raw JSONL rather than parsing every entry: a parse of forty
 * transcripts to answer a keystroke-driven query is far more work than a
 * substring test, and a miss on the raw text cannot hide a hit in the parsed
 * form. Only files that match are then parsed, to pull the surrounding line.
 */
function search(projectDir, query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const dir = sessionDir(projectDir);
  if (!dir) return [];

  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const hits = [];
  const titles = readTitles();

  for (const f of files) {
    const full = path.join(dir, f);
    let raw;
    try {
      if (fs.statSync(full).size > MAX_TITLE_BYTES) continue;
      raw = fs.readFileSync(full, 'utf8');
    } catch { continue; }

    if (!raw.toLowerCase().includes(q)) continue;

    const id = path.basename(f, '.jsonl');
    let snippet = '';
    let matches = 0;

    for (const line of raw.split('\n')) {
      if (!line.toLowerCase().includes(q)) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const role = entry?.message?.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const content = entry.message.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('')
          : '';
      const flat = text.replace(/\s+/g, ' ').trim();
      const at = flat.toLowerCase().indexOf(q);
      if (at < 0) continue;

      matches += 1;
      if (!snippet) {
        // A window around the hit, so you can see why it matched.
        const from = Math.max(0, at - 50);
        snippet = (from ? '…' : '') + flat.slice(from, at + q.length + 90).trim();
      }
    }

    // The phrase can appear only inside tool output or metadata, which matched
    // the raw file but no message — reporting that as a conversation hit sends
    // you to a transcript where you cannot find the word.
    if (!matches) continue;

    let updated = 0;
    try { updated = fs.statSync(full).mtimeMs; } catch { /* gone mid-scan */ }
    hits.push({
      id,
      title: titles[id] || titleFrom(full) || 'Untitled conversation',
      snippet,
      matches,
      updated,
    });
  }

  hits.sort((a, b) => b.updated - a.updated);
  return hits.slice(0, MAX_HITS);
}

module.exports = {
  list, read, rename, remove, search, slugFor, sessionDir, readTitles,
};
