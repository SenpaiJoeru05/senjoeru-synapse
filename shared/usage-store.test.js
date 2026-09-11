const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * The store resolves its file relative to its own directory, so these tests
 * run it from a throwaway copy of the repo layout rather than touching the
 * real `data/claude-usage.json`.
 *
 * Each case gets its own temp root and a fresh module instance, because the
 * behaviour under test IS the module-level cache.
 */
function freshStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-store-'));
  fs.mkdirSync(path.join(root, 'shared'));
  for (const f of ['usage-store.js', 'usage-limits.js']) {
    fs.copyFileSync(path.join(__dirname, f), path.join(root, 'shared', f));
  }
  const modulePath = path.join(root, 'shared', 'usage-store.js');
  // Distinct path per temp root, so require() hands back a new instance.
  const store = require(modulePath);
  return { store, root, file: path.join(root, 'data', 'claude-usage.json') };
}

const EVENT = {
  status: 'allowed',
  rateLimitType: 'five_hour',
  unifiedWindows: {
    five_hour: { utilization: 0.29, resetsAt: 1789102800 },
    seven_day: { utilization: 0.64, resetsAt: 1789131600 },
  },
};

test('nothing recorded reads as unknown, not as zero usage', () => {
  const { store } = freshStore();
  const out = store.read();
  assert.strictEqual(out.usage, null);
  assert.strictEqual(out.stale, true);
  assert.strictEqual(out.ageMs, null);
});

test('a recorded event round-trips through the file', () => {
  const { store, file } = freshStore();
  store.recordStreamEvent(EVENT);
  assert.ok(fs.existsSync(file), 'file should have been written');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(onDisk.windows.five_hour.usedPercent, 29);
  const out = store.read();
  assert.strictEqual(out.usage.windows.seven_day.usedPercent, 64);
  assert.strictEqual(out.stale, false);
});

test('an unusable event writes nothing at all', () => {
  const { store, file } = freshStore();
  assert.strictEqual(store.recordStreamEvent({ unifiedWindows: {} }), null);
  assert.strictEqual(fs.existsSync(file), false);
});

test('a reader sees a write made by another process', () => {
  /*
   * The bug this exists for: the backend is a separate process that only ever
   * reads this file, and `require`'s module cache plus an unconditional
   * in-memory cache meant it served its first reading forever while the real
   * numbers moved. Caught in review before shipping; kept covered so it
   * cannot come back quietly.
   */
  const { store, file } = freshStore();
  store.read(); // Prime the cache with "nothing known".

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    source: 'stream',
    at: Date.now(),
    status: 'allowed',
    binding: 'five_hour',
    windows: { five_hour: { usedPercent: 42, resetsAt: 1789102800 } },
  }));

  assert.strictEqual(store.read().usage.windows.five_hour.usedPercent, 42);
});

test('a later write by another process replaces an earlier cached reading', () => {
  const { store, file } = freshStore();
  store.recordStreamEvent(EVENT);
  assert.strictEqual(store.read().usage.windows.five_hour.usedPercent, 29);

  // mtime resolution can be coarse; make the change unambiguous.
  const future = Date.now() + 60_000;
  fs.writeFileSync(file, JSON.stringify({
    source: 'statusline',
    at: future,
    status: 'allowed',
    binding: null,
    windows: { five_hour: { usedPercent: 77, resetsAt: 1789102800 } },
  }));
  fs.utimesSync(file, new Date(future), new Date(future));

  assert.strictEqual(store.read().usage.windows.five_hour.usedPercent, 77);
});

test('an out-of-order (older) event does not overwrite a newer reading', () => {
  const { store } = freshStore();
  const newer = { ...EVENT };
  store.record(require(path.join(__dirname, 'usage-limits'))
    .fromStreamEvent(newer, Date.now()));

  const stale = require(path.join(__dirname, 'usage-limits'))
    .fromStreamEvent({ unifiedWindows: { five_hour: { utilization: 0.01 } } }, Date.now() - 60_000);
  store.record(stale);

  // Overlapping Chat and Assistant Mode calls can land out of order; the
  // newest reading has to win regardless of arrival order.
  assert.strictEqual(store.read().usage.windows.five_hour.usedPercent, 29);
});

test('a corrupt file does not drop a reading already held', () => {
  const { store, file } = freshStore();
  store.recordStreamEvent(EVENT);
  const later = Date.now() + 60_000;
  fs.writeFileSync(file, '{ this is not json');
  fs.utimesSync(file, new Date(later), new Date(later));
  // Mid-write truncation must not make the widget flash to "unknown".
  assert.strictEqual(store.read().usage.windows.five_hour.usedPercent, 29);
});

test('subscribers are notified of a new reading, after it is persisted', () => {
  const { store, file } = freshStore();
  const seen = [];
  const off = store.subscribe((s) => {
    // Read back inside the callback: a subscriber that persists or forwards
    // must not see a snapshot the file does not yet have.
    seen.push({ pct: s.windows.five_hour.usedPercent, onDisk: fs.existsSync(file) });
  });

  store.recordStreamEvent(EVENT);
  assert.deepStrictEqual(seen, [{ pct: 29, onDisk: true }]);

  off();
  store.recordStreamEvent({
    ...EVENT,
    unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1789102800 } },
  });
  assert.strictEqual(seen.length, 1, 'unsubscribed listener should not fire');
});

test('a throwing subscriber does not break the record or the others', () => {
  const { store } = freshStore();
  let reached = false;
  store.subscribe(() => { throw new Error('observer blew up'); });
  store.subscribe(() => { reached = true; });

  const snap = store.recordStreamEvent(EVENT);
  assert.ok(snap, 'the reading must still be recorded');
  assert.strictEqual(reached, true, 'later subscribers must still run');
  assert.strictEqual(store.read().usage.windows.five_hour.usedPercent, 29);
});

test('subscribers do not fire for an unusable event', () => {
  const { store } = freshStore();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.recordStreamEvent({ unifiedWindows: {} });
  assert.strictEqual(calls, 0);
});

test('statusline percentages are stored without being rescaled', () => {
  const { store } = freshStore();
  store.recordStatusline({ five_hour: { used_percentage: 29, resets_at: '2026-09-11T05:00:00Z' } });
  assert.strictEqual(store.read().usage.windows.five_hour.usedPercent, 29);
  assert.strictEqual(store.read().usage.source, 'statusline');
});
