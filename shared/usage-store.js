/**
 * The last known account usage, kept on disk at `data/claude-usage.json`.
 *
 * Lives in shared/ because it has four readers and two writers, and the write
 * side is not trivial enough to copy:
 *
 *   writes — Electron (from `rate_limit_event` on Chat/Assistant answers)
 *            and the optional statusline collector (from Joel's interactive
 *            terminal sessions, at zero token cost)
 *   reads  — Electron IPC, the backend's /api/usage for the browser build,
 *            and anything else that wants the figures
 *
 * Last writer wins, subject to the ordering guard below. That is correct here:
 * every producer reports the same account-wide windows, so the newest reading
 * is the best one no matter which session happened to observe it.
 *
 * Why on disk at all: the numbers arrive as a side effect of answering a
 * question, so a fresh app start has none until Joel next asks something. A
 * file means the widget opens on "64% weekly, 20 minutes ago" instead of an
 * empty box — stale-but-labelled beats blank.
 */
const fs = require('fs');
const path = require('path');

const { fromStreamEvent, fromStatusline, isStale } = require('./usage-limits');

const FILE = path.join(__dirname, '..', 'data', 'claude-usage.json');

/**
 * In-memory copy, so a read never waits on the disk and a failed write does
 * not discard a reading we already hold.
 *
 * `cachedMtimeMs` is what makes the cache safe ACROSS PROCESSES, and it is not
 * an optimisation. Electron writes this file; the backend is a different
 * process that only reads it. Caching the first parse and keeping it — which
 * is what a plain `if (cached) return cached` does — meant the backend served
 * one reading forever while the real figures moved underneath it, and
 * `require`'s module cache guaranteed the stale copy survived every request.
 * So the cache is only trusted while the file's mtime is unchanged.
 */
let cached = null;
let cachedMtimeMs = null;

function write(snapshot) {
  /*
   * Temp + rename, the same discipline as the task board. A half-written file
   * here is not cosmetic: readers parse it on a timer, and a truncated object
   * throws inside the widget. The pid in the name keeps two writers — Electron
   * and a statusline invocation — from colliding on the same temp path.
   */
  const tmp = `${FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, FILE);
    return true;
  } catch {
    // Bookkeeping must never break an answer, or a status line.
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return false;
  }
}

/**
 * The current snapshot, re-reading whenever the file has changed on disk.
 *
 * A cold process gets the last known figures; a long-lived reader (the
 * backend) picks up whatever the writer (Electron) has since recorded.
 */
function load() {
  let mtimeMs = null;
  try {
    mtimeMs = fs.statSync(FILE).mtimeMs;
  } catch {
    // No file. Keep any in-memory reading — this process may be the writer,
    // and having recorded a snapshot is not undone by the file going missing.
    return cached;
  }
  if (cached && cachedMtimeMs === mtimeMs) return cached;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && parsed.windows) {
      cached = parsed;
      cachedMtimeMs = mtimeMs;
    }
  } catch {
    // Unreadable or mid-write. Fall back to whatever we already hold rather
    // than dropping to "unknown" for one poll.
  }
  return cached;
}

/**
 * In-process observers, so a new reading can be pushed rather than waited for.
 *
 * Without this the widgets learn about a change on their next poll, which is
 * up to a minute after the answer that produced it — long enough that asking
 * "how much have I used" and watching the bar not move looks like a bug. The
 * Electron main process subscribes here and broadcasts to every open window.
 *
 * Deliberately in-process only: the backend is a separate process and gets its
 * updates by noticing the file's mtime (see `load`).
 */
const listeners = new Set();

/** Subscribe to new readings. Returns an unsubscribe function. */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(snapshot) {
  for (const fn of listeners) {
    // One bad listener must not stop the others, or lose the reading.
    try { fn(snapshot); } catch { /* observers are advisory */ }
  }
}

/** Persist a normalised snapshot. Returns it, or the newer one already held. */
function record(snapshot) {
  if (!snapshot) return null;
  /*
   * Do not let an older reading overwrite a newer one. Two calls can overlap —
   * Assistant Mode answering while Chat streams — and their events can land
   * out of order. Same for a statusline invocation racing an answer.
   */
  const held = load();
  if (held && typeof held.at === 'number' && held.at > snapshot.at) return held;
  cached = snapshot;
  write(snapshot);
  // The file we just wrote is the one we hold, so record its mtime — without
  // this the next read would re-parse our own write on every single call.
  try { cachedMtimeMs = fs.statSync(FILE).mtimeMs; } catch { cachedMtimeMs = null; }
  // After the write, so an observer that reads back gets the persisted value.
  notify(snapshot);
  return snapshot;
}

/** Record a `rate_limit_info` seen on the CLI's stream-json output. */
function recordStreamEvent(info) {
  return record(fromStreamEvent(info));
}

/** Record a statusline hook payload's `rate_limits` (already 0-100). */
function recordStatusline(rateLimits) {
  return record(fromStatusline(rateLimits));
}

/**
 * The last known snapshot with its age.
 *
 * `usage: null` means never observed — which is NOT zero usage, and callers
 * must render it as unknown. It stays null permanently on API-key, Bedrock and
 * Vertex sessions, where plan windows do not apply at all.
 */
function read() {
  const snapshot = load();
  if (!snapshot) return { usage: null, stale: true, ageMs: null };
  return {
    usage: snapshot,
    stale: isStale(snapshot),
    ageMs: Date.now() - snapshot.at,
  };
}

module.exports = {
  record, recordStreamEvent, recordStatusline, read, subscribe, FILE,
};
