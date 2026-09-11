const test = require('node:test');
const assert = require('node:assert');

const { toCues, cueAt, toLines, MAX_CUE_CHARS } = require('./captions');

const ANSWER = "You're at 57 per cent of your five hour window, resetting in about "
  + 'four hours. The weekly limit is at 67 per cent, so there is plenty of room '
  + 'for the rest of today.';

test('cues cover the whole utterance with no gaps and no overlap', () => {
  const cues = toCues(ANSWER);
  assert.ok(cues.length > 1, 'a long answer should be more than one cue');
  assert.strictEqual(cues[0].from, 0);
  assert.strictEqual(cues[cues.length - 1].to, 1);
  for (let i = 1; i < cues.length; i++) {
    // Each cue starts exactly where the last ended — a gap would blank the
    // caption mid-sentence, an overlap would show two at once.
    assert.strictEqual(cues[i].from, cues[i - 1].to);
  }
});

test('no cue exceeds two lines worth of characters', () => {
  for (const cue of toCues(ANSWER)) {
    assert.ok(cue.text.length <= MAX_CUE_CHARS, `too long (${cue.text.length}): ${cue.text}`);
  }
});

test('no word is lost or duplicated in the split', () => {
  const joined = toCues(ANSWER).map((c) => c.text).join(' ');
  assert.strictEqual(joined, ANSWER.replace(/\s+/g, ' ').trim());
});

test('a short answer is a single cue spanning the whole utterance', () => {
  const cues = toCues('Got it.');
  assert.strictEqual(cues.length, 1);
  assert.deepStrictEqual(
    { text: cues[0].text, from: cues[0].from, to: cues[0].to },
    { text: 'Got it.', from: 0, to: 1 },
  );
});

test('cues prefer to break at sentence ends', () => {
  const cues = toCues(
    'The build failed on fsweb this morning. Everything else is green right now.',
  );
  // The first cue should end a sentence rather than dragging the next one in.
  assert.ok(/[.!?]$/.test(cues[0].text), `expected a sentence end: ${cues[0].text}`);
});

test('a very short sentence is not flashed on its own', () => {
  /*
   * Without the length floor, "Yes." becomes its own cue and appears for a
   * fraction of a second - a flicker, not a caption.
   */
  const cues = toCues('Yes. The weekly limit is at 67 per cent and still climbing.');
  assert.ok(!cues.some((c) => c.text === 'Yes.'), 'should not be a cue of its own');
});

test('punctuation is charged time, so captions do not run ahead', () => {
  /*
   * Two halves of equal length, but the first is full of pauses. Charging
   * nothing for them would give both the same share of the duration while the
   * voice is still breathing through the first.
   */
  const pausey = toCues('One. Two. Three. Four.', { maxChars: 11 });
  assert.ok(pausey.length >= 2);
  const first = pausey[0];
  assert.ok(first.to > first.text.length / 'One. Two. Three. Four.'.length,
    'a cue full of stops should claim more than its character share');
});

test('a word longer than a whole cue is emitted alone rather than looping', () => {
  const long = 'x'.repeat(200);
  const cues = toCues(`before ${long} after`);
  assert.ok(cues.some((c) => c.text === long));
  assert.strictEqual(cues[cues.length - 1].to, 1);
});

test('empty input yields no cues rather than an empty one', () => {
  assert.deepStrictEqual(toCues(''), []);
  assert.deepStrictEqual(toCues('   '), []);
  assert.deepStrictEqual(toCues(null), []);
});

test('cueAt walks forward through playback', () => {
  const cues = toCues(ANSWER);
  assert.strictEqual(cueAt(cues, 0).text, cues[0].text);
  assert.strictEqual(cueAt(cues, 0.999).text, cues[cues.length - 1].text);
  // Monotonic: the index never goes backwards as progress increases.
  let last = -1;
  for (let p = 0; p <= 1; p += 0.01) {
    const idx = cues.indexOf(cueAt(cues, p));
    assert.ok(idx >= last, `went backwards at ${p}`);
    last = idx;
  }
});

test('cueAt clamps rather than blanking outside 0..1', () => {
  const cues = toCues(ANSWER);
  // Before playback the first cue should already be up; after it, the last
  // should stay rather than blanking a beat before the audio ends.
  assert.strictEqual(cueAt(cues, -1).text, cues[0].text);
  assert.strictEqual(cueAt(cues, 2).text, cues[cues.length - 1].text);
  assert.strictEqual(cueAt(cues, NaN).text, cues[0].text);
  assert.strictEqual(cueAt([], 0.5), null);
  assert.strictEqual(cueAt(null, 0.5), null);
});

test('toLines wraps to at most two lines', () => {
  const lines = toLines(
    'The weekly limit is at sixty seven per cent and there is plenty of room left',
  );
  assert.ok(lines.length <= 2);
  for (const l of lines) assert.ok(l.length <= 38, `line too wide: ${l}`);
});

test('toLines never splits a word across lines', () => {
  const text = 'resetting in about four hours and twenty three minutes from now';
  const lines = toLines(text);
  for (const l of lines) {
    for (const w of l.split(' ')) assert.ok(text.includes(w), `mangled word: ${w}`);
  }
});

test('toLines on empty input is an empty array, not [""]', () => {
  assert.deepStrictEqual(toLines(''), []);
  assert.deepStrictEqual(toLines(null), []);
});

test('a realistic answer produces readable, evenly paced cues', () => {
  const cues = toCues(ANSWER);
  for (const cue of cues) {
    const span = cue.to - cue.from;
    // No cue should be a flash or hog the whole utterance.
    assert.ok(span > 0.05, `too brief (${span.toFixed(3)}): ${cue.text}`);
    assert.ok(span < 0.75, `too long (${span.toFixed(3)}): ${cue.text}`);
    assert.ok(toLines(cue.text).length <= 2);
  }
});
