const test = require('node:test');
const assert = require('node:assert');

const { speakable } = require('./speakable');

test('the reported bug: bold is not read as "star star"', () => {
  // Verbatim shape of what Piper said out loud.
  assert.strictEqual(
    speakable("What's the price of the **hoverboard**?"),
    "What's the price of the hoverboard?",
  );
  assert.ok(!speakable('**bold**').includes('*'));
});

test('every emphasis style loses its syntax and keeps its words', () => {
  assert.strictEqual(speakable('***all three***'), 'all three');
  assert.strictEqual(speakable('**bold** and *italic*'), 'bold and italic');
  assert.strictEqual(speakable('~~struck~~ out'), 'struck out');
  assert.strictEqual(speakable('_emphasis_ here'), 'emphasis here');
  assert.strictEqual(speakable('__strong__ here'), 'strong here');
});

test('bold is stripped before italic, so no lone asterisk survives', () => {
  /*
   * Order matters: running the italic rule first takes one asterisk from each
   * side of a bold run and leaves the other, which turns "star star" into a
   * single "star" — quieter, still wrong.
   */
  assert.strictEqual(speakable('**a** and **b**'), 'a and b');
  assert.ok(!speakable('**a** *b* **c**').includes('*'));
});

test('snake_case identifiers are left alone', () => {
  // A blanket underscore strip would say "filepath" and "tasklastupdated".
  assert.strictEqual(speakable('check file_path and task_id'), 'check file_path and task_id');
  assert.strictEqual(speakable('task_last_updated'), 'task_last_updated');
});

test('inline code loses its backticks but keeps the word', () => {
  assert.strictEqual(speakable('run `npm test` now'), 'run npm test now');
  assert.strictEqual(speakable('a ` stray backtick'), 'a stray backtick');
});

test('a code block is announced, not silently dropped', () => {
  /*
   * Deleting it would have the voice skip the thing the answer was about,
   * with no sign anything was missing. A placeholder is recoverable.
   */
  const out = speakable('Here:\n```js\nconst x = 1\n```\nthat is it.');
  assert.match(out, /code omitted/);
  assert.ok(!out.includes('const x'));
  assert.ok(!out.includes('```'));
});

test('an unterminated code fence does not leak the rest of the answer', () => {
  // What a truncated or cancelled answer produces.
  const out = speakable('Try this:\n```js\nconst x = 1');
  assert.match(out, /code omitted/);
  assert.ok(!out.includes('const x'));
});

test('links are spoken as their text, never their URL', () => {
  assert.strictEqual(
    speakable('see [the dashboard](https://example.com/a/b?c=d)'),
    'see the dashboard',
  );
  assert.strictEqual(speakable('![a chart](chart.png)'), 'a chart');
  // Images before links, or the alt text arrives with a leading "!".
  assert.ok(!speakable('![a chart](chart.png)').startsWith('!'));
});

test('headings and quotes keep their text', () => {
  assert.strictEqual(speakable('## Status\nAll clear.'), 'Status. All clear.');
  assert.strictEqual(speakable('> quoted thing'), 'quoted thing');
});

test('list items become separate sentences rather than one run-on', () => {
  /*
   * Deleting the bullet alone runs every item into the last, so five items
   * arrive in one breath. A full stop is the closest speech has to a list.
   */
  const out = speakable('- first\n- second\n- third');
  // No trailing stop on the final item: there is no following line to break
  // from, and inventing one would be punctuation the text never had.
  assert.strictEqual(out, 'first. second. third');
  assert.strictEqual(speakable('1. one\n2. two'), 'one. two');
});

test('a table is not read as a row of pipes', () => {
  const out = speakable('| name | status |\n| --- | --- |\n| build | ok |');
  assert.ok(!out.includes('|'));
  assert.match(out, /name/);
  assert.match(out, /build/);
  // The separator row is formatting and carries nothing.
  assert.ok(!out.includes('---'));
});

test('horizontal rules disappear entirely', () => {
  // As above: the final segment keeps whatever punctuation it actually had.
  assert.strictEqual(speakable('before\n\n---\n\nafter'), 'before. after');
});

test('punctuation is not doubled or orphaned', () => {
  assert.ok(!/\s[.,]/.test(speakable('**done**. next')));
  assert.ok(!/\.\s*\./.test(speakable('one.\ntwo.')));
});

test('plain prose is returned untouched', () => {
  // The common case must not be damaged by any of the above.
  const plain = "You're at 57 per cent of your five hour window, plenty of room.";
  assert.strictEqual(speakable(plain), plain);
});

test('empty and non-string input is safe', () => {
  assert.strictEqual(speakable(''), '');
  assert.strictEqual(speakable('   '), '');
  assert.strictEqual(speakable(null), '');
  assert.strictEqual(speakable(undefined), '');
  assert.strictEqual(speakable(42), '42');
});

test('a realistic markdown answer comes out speakable', () => {
  const answer = [
    '## Current state',
    '',
    'You have **two** items needing attention:',
    '',
    '- `build` failed on *fsweb*',
    '- [review needed](http://localhost:5173/tasks) on chat-widget',
    '',
    'Weekly limit is at __67%__.',
  ].join('\n');

  const out = speakable(answer);
  for (const ch of ['*', '`', '[', ']', '#', '|']) {
    assert.ok(!out.includes(ch), `"${ch}" should not survive: ${out}`);
  }
  assert.match(out, /two items needing attention/);
  assert.match(out, /review needed/);
  assert.ok(!out.includes('localhost'));
});
