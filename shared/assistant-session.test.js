const test = require('node:test');
const assert = require('node:assert');

const { resumeFlags, createTracker } = require('./assistant-session');

/* ── resumeFlags ─────────────────────────────────────────────────────────── */

test('a session nobody has seen is STARTED, not resumed', () => {
  assert.deepStrictEqual(
    resumeFlags('abc', { started: new Set(), exists: () => false }),
    ['--session-id', 'abc'],
  );
});

test('a session with a transcript on disk is RESUMED', () => {
  assert.deepStrictEqual(
    resumeFlags('abc', { started: new Set(), exists: () => true }),
    ['--resume', 'abc'],
  );
});

test('the disk wins even when this process never started the session', () => {
  /*
   * This is the exact regression that produced "Session ID <uuid> is already
   * in use". The in-memory set is empty on every app start, and opening a
   * stored conversation from Chat's sidebar hands the renderer an id the main
   * process has never seen — so relying on the set passed --session-id for a
   * session the CLI already had, and the CLI refused the call.
   */
  const flags = resumeFlags('from-a-previous-run', {
    started: new Set(),
    exists: (id) => id === 'from-a-previous-run',
  });
  assert.deepStrictEqual(flags, ['--resume', 'from-a-previous-run']);
});

test('the in-memory set resumes a session created moments ago', () => {
  // The fast path: the transcript may not be flushed yet, so disk says no
  // while we know we just created it.
  assert.deepStrictEqual(
    resumeFlags('fresh', { started: new Set(['fresh']), exists: () => false }),
    ['--resume', 'fresh'],
  );
});

test('a throwing existence check degrades to starting a new session', () => {
  // Never let a broken lookup refuse to answer — starting fresh is the
  // behaviour that predates the check, and it is recoverable.
  assert.deepStrictEqual(
    resumeFlags('abc', { started: new Set(), exists: () => { throw new Error('nope'); } }),
    ['--session-id', 'abc'],
  );
});

test('missing dependencies still produce a usable decision', () => {
  assert.deepStrictEqual(resumeFlags('abc'), ['--session-id', 'abc']);
  assert.deepStrictEqual(resumeFlags('abc', {}), ['--session-id', 'abc']);
});

test('an empty session id throws rather than producing a broken argv', () => {
  // Splicing ['--resume', ''] into the command line would make the CLI fail
  // with something unrelated to the real mistake.
  for (const bad of ['', '   ', null, undefined]) {
    assert.throws(() => resumeFlags(bad, { exists: () => false }), /session id is required/);
  }
});

/* ── createTracker ───────────────────────────────────────────────────────── */

function counter() {
  let n = 0;
  // eslint-disable-next-line no-plusplus
  return () => `session-${++n}`;
}

test('the session is minted on first use, then stays put', () => {
  const t = createTracker({ uuid: counter() });
  assert.strictEqual(t.started(), false);
  const first = t.current();
  assert.strictEqual(first, 'session-1');
  // The whole point: a second question is the SAME conversation.
  assert.strictEqual(t.current(), 'session-1');
  assert.strictEqual(t.current(), 'session-1');
  assert.strictEqual(t.started(), true);
});

test('reset starts a new conversation and reports the one it replaced', () => {
  const t = createTracker({ uuid: counter() });
  const first = t.current();
  const { id, previous } = t.reset();
  assert.strictEqual(previous, first);
  assert.notStrictEqual(id, first);
  assert.strictEqual(t.current(), id);
});

test('reset before anything was asked still yields a usable session', () => {
  const t = createTracker({ uuid: counter() });
  const { id, previous } = t.reset();
  assert.strictEqual(previous, null);
  assert.ok(id);
  assert.strictEqual(t.current(), id);
});

test('every session this run used is recoverable, oldest first', () => {
  const t = createTracker({ uuid: counter() });
  t.current();
  t.reset();
  t.reset();
  assert.deepStrictEqual(t.all(), ['session-1', 'session-2', 'session-3']);
});

test('a tracker without a uuid function throws at construction', () => {
  // Fails where the mistake is, rather than returning undefined ids that
  // would surface later as an unexplained CLI error.
  assert.throws(() => createTracker(), /requires a uuid/);
  assert.throws(() => createTracker({ uuid: 'nope' }), /requires a uuid/);
});

test('tracker and resumeFlags compose: first turn starts, second resumes', () => {
  const t = createTracker({ uuid: counter() });
  const started = new Set();
  const disk = new Set();

  const id = t.current();
  const firstTurn = resumeFlags(id, { started, exists: (x) => disk.has(x) });
  assert.deepStrictEqual(firstTurn, ['--session-id', id]);

  // The CLI now owns the session; both the set and the disk know it.
  started.add(id);
  disk.add(id);

  const secondTurn = resumeFlags(t.current(), { started, exists: (x) => disk.has(x) });
  assert.deepStrictEqual(secondTurn, ['--resume', id]);

  // And a reset must go back to starting, not resuming — resuming an id the
  // CLI has never seen fails just as loudly.
  const next = t.reset().id;
  assert.deepStrictEqual(
    resumeFlags(next, { started, exists: (x) => disk.has(x) }),
    ['--session-id', next],
  );
});
