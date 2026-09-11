const test = require('node:test');
const assert = require('node:assert');

const {
  fromStreamEvent,
  fromStatusline,
  normalize,
  formatReset,
  describe: describeUsage,
  isStale,
  FRACTION,
  PERCENT,
} = require('./usage-limits');

/**
 * Captured verbatim from a real `claude -p --output-format stream-json` run on
 * 2026-09-11, so the shape under test is the shape that actually arrives
 * rather than the shape I assumed.
 */
const REAL_EVENT = {
  status: 'allowed',
  resetsAt: 1789102800,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  overageDisabledReason: 'org_level_disabled',
  isUsingOverage: false,
  unifiedWindows: {
    five_hour: { utilization: 0.29, resetsAt: 1789102800 },
    seven_day: { utilization: 0.64, resetsAt: 1789131600 },
  },
};

test('stream event: fractions become percentages', () => {
  const snap = fromStreamEvent(REAL_EVENT, 1789085000000);
  // 0.29 is 29%, not 0.29% — the whole point of carrying scale explicitly.
  assert.strictEqual(snap.windows.five_hour.usedPercent, 29);
  assert.strictEqual(snap.windows.seven_day.usedPercent, 64);
  assert.strictEqual(snap.windows.five_hour.resetsAt, 1789102800);
  assert.strictEqual(snap.status, 'allowed');
  assert.strictEqual(snap.binding, 'five_hour');
  assert.strictEqual(snap.source, 'stream');
});

test('statusline: used_percentage is already a percentage and is NOT scaled again', () => {
  // The regression this guards: treating 29 as a fraction yields 2900%, and
  // treating 0.29 as a percentage yields 0.29% — opposite failures, same bug.
  const snap = fromStatusline({
    five_hour: { used_percentage: 29, resets_at: '2026-09-11T05:00:00Z' },
    seven_day: { used_percentage: 64, resets_at: '2026-09-11T13:00:00Z' },
  });
  assert.strictEqual(snap.windows.five_hour.usedPercent, 29);
  assert.strictEqual(snap.windows.seven_day.usedPercent, 64);
  // ISO string resolved to unix seconds.
  assert.strictEqual(snap.windows.five_hour.resetsAt, 1789102800);
});

test('both sources agree on the same underlying usage', () => {
  const fromStream = fromStreamEvent(REAL_EVENT);
  const fromLine = fromStatusline({
    five_hour: { used_percentage: 29, resets_at: '2026-09-11T05:00:00Z' },
  });
  assert.strictEqual(
    fromStream.windows.five_hour.usedPercent,
    fromLine.windows.five_hour.usedPercent,
  );
});

test('no usable window yields null, never a zeroed snapshot', () => {
  // An API-key or Bedrock session has no plan limits at all. Reporting 0%
  // there would tell Joel he has a full window when he has no window.
  assert.strictEqual(fromStreamEvent(null), null);
  assert.strictEqual(fromStreamEvent({}), null);
  assert.strictEqual(fromStreamEvent({ unifiedWindows: {} }), null);
  assert.strictEqual(fromStatusline(null), null);
  assert.strictEqual(fromStreamEvent({ unifiedWindows: { five_hour: {} } }), null);
});

test('a window with no utilization is dropped, not defaulted to zero', () => {
  const snap = fromStreamEvent({
    unifiedWindows: {
      five_hour: { utilization: 0.5, resetsAt: 1789102800 },
      seven_day: { resetsAt: 1789131600 },
    },
  });
  assert.strictEqual(snap.windows.five_hour.usedPercent, 50);
  assert.ok(!('seven_day' in snap.windows));
});

test('utilization clamps into 0-100', () => {
  const over = fromStreamEvent({ unifiedWindows: { five_hour: { utilization: 1.03 } } });
  assert.strictEqual(over.windows.five_hour.usedPercent, 100);
  const under = fromStreamEvent({ unifiedWindows: { five_hour: { utilization: -0.2 } } });
  assert.strictEqual(under.windows.five_hour.usedPercent, 0);
});

test('one decimal of resolution is kept', () => {
  const snap = fromStreamEvent({ unifiedWindows: { seven_day: { utilization: 0.6449 } } });
  assert.strictEqual(snap.windows.seven_day.usedPercent, 64.5);
});

test('an unknown or unparseable reset is null, not 1970', () => {
  const snap = fromStreamEvent({
    unifiedWindows: {
      five_hour: { utilization: 0.1 },
      seven_day: { utilization: 0.2, resetsAt: 'not a date' },
    },
  });
  assert.strictEqual(snap.windows.five_hour.resetsAt, null);
  assert.strictEqual(snap.windows.seven_day.resetsAt, null);
  // And it must render as absent rather than as a negative duration.
  assert.strictEqual(formatReset(null), null);
});

test('milliseconds are not mistaken for seconds', () => {
  const snap = fromStreamEvent({
    unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1789102800000 } },
  });
  assert.strictEqual(snap.windows.five_hour.resetsAt, 1789102800);
});

test('binding window is only reported when we actually have that window', () => {
  const snap = fromStreamEvent({
    rateLimitType: 'seven_day_opus',
    unifiedWindows: { five_hour: { utilization: 0.1 } },
  });
  assert.strictEqual(snap.binding, null);
});

test('per-model weekly windows come through when present', () => {
  const snap = fromStreamEvent({
    unifiedWindows: {
      five_hour: { utilization: 0.1 },
      seven_day_opus: { utilization: 0.8, resetsAt: 1789131600 },
      seven_day_sonnet: { utilization: 0.2, resetsAt: 1789131600 },
    },
  });
  assert.strictEqual(snap.windows.seven_day_opus.usedPercent, 80);
  assert.strictEqual(snap.windows.seven_day_sonnet.usedPercent, 20);
});

test('an unrecognised window is ignored rather than surfaced raw', () => {
  const snap = fromStreamEvent({
    unifiedWindows: {
      five_hour: { utilization: 0.1 },
      cinder_cove: { utilization: 0.9 },
    },
  });
  assert.deepStrictEqual(Object.keys(snap.windows), ['five_hour']);
});

test('a bad scale throws instead of silently picking one', () => {
  assert.throws(
    () => normalize({ source: 'x', scale: 'guess', windows: { five_hour: { utilization: 1 } } }),
    /scale must be/,
  );
});

test('formatReset renders hours and minutes', () => {
  const now = 1789085000000;
  assert.strictEqual(formatReset(1789102800, now), '4h 57m');
  assert.strictEqual(formatReset(1789085000 + 2400, now), '40m');
  assert.strictEqual(formatReset(1789085000 + 7200, now), '2h');
  // Already past.
  assert.strictEqual(formatReset(1789085000 - 60, now), null);
});

test('describe says the numbers and only the numbers', () => {
  const line = describeUsage(fromStreamEvent(REAL_EVENT), 1789085000000);
  assert.match(line, /session limit 29% used/);
  assert.match(line, /weekly limit 64% used/);
  assert.match(line, /resets in 4h 57m/);
  // No spend, no advice — over-answering is the failure mode this guards.
  assert.ok(!/\$/.test(line));
});

test('describe admits when it cannot see usage', () => {
  assert.match(describeUsage(null), /cannot see/);
});

test('staleness is reported, and an absent snapshot is stale', () => {
  const now = 1789085000000;
  assert.strictEqual(isStale({ at: now - 1000 }, 60000, now), false);
  assert.strictEqual(isStale({ at: now - 120000 }, 60000, now), true);
  assert.strictEqual(isStale(null, 60000, now), true);
});

test('scale constants are the only accepted values', () => {
  assert.strictEqual(FRACTION, 'fraction');
  assert.strictEqual(PERCENT, 'percent');
});
