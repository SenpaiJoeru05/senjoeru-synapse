const test = require('node:test');
const assert = require('node:assert/strict');

const { describeToolCall } = require('./describe-tool-call');

test('Read/Write/Edit report the basename, not the full path', () => {
  assert.equal(
    describeToolCall('Read', { file_path: 'D:\\repo\\src\\Foo.tsx' }).label,
    'Reading Foo.tsx',
  );
  assert.equal(
    describeToolCall('Write', { file_path: '/repo/src/bar.js' }).label,
    'Writing bar.js',
  );
  assert.equal(
    describeToolCall('Edit', { file_path: 'D:\\repo\\baz.ts' }).label,
    'Editing baz.ts',
  );
  assert.equal(describeToolCall('MultiEdit', { file_path: 'x/y.ts' }).label, 'Editing y.ts');
});

test('both file_path and filePath shapes are read — the task 25 lesson', () => {
  // The CLI reports file_path on some tools and filePath on others; missing
  // either shape silently blanked the detail before this was fixed once.
  assert.equal(describeToolCall('Read', { filePath: 'a/b/c.ts' }).label, 'Reading c.ts');
  assert.equal(describeToolCall('Read', { file_path: 'a/b/c.ts' }).label, 'Reading c.ts');
});

test('Bash is truncated to about 40 characters, not the whole command', () => {
  const short = describeToolCall('Bash', { command: 'npm test' });
  assert.equal(short.label, 'npm test');

  const long = describeToolCall('Bash', {
    command: 'node --test services/*.test.js lib/*.test.js --some-very-long-flag-here',
  });
  assert.ok(long.label.length <= 41); // 40 chars + the ellipsis character
  assert.ok(long.label.endsWith('…'));
});

test('Grep and Glob report the pattern', () => {
  assert.equal(describeToolCall('Grep', { pattern: 'TODO' }).label, 'Searching "TODO"');
  assert.equal(describeToolCall('Glob', { pattern: '**/*.tsx' }).label, 'Looking for **/*.tsx');
});

test('Task and Agent both report delegation — the CLI calls the same tool by two names', () => {
  // Verified live: the granted tool is named "Task" in --allowedTools, but the
  // actual transcript and hook payloads label the tool_use "Agent".
  assert.equal(
    describeToolCall('Task', { subagent_type: 'backend-engineer' }).label,
    'Delegating to backend-engineer',
  );
  assert.equal(
    describeToolCall('Agent', { subagent_type: 'Explore' }).label,
    'Delegating to Explore',
  );
});

test('WebSearch and WebFetch report the query or url verbatim', () => {
  assert.equal(describeToolCall('WebSearch', { query: 'claude code hooks' }).label,
    'claude code hooks');
  assert.equal(describeToolCall('WebFetch', { url: 'https://example.com' }).label,
    'https://example.com');
});

test('TodoWrite has a fixed label regardless of input', () => {
  assert.equal(describeToolCall('TodoWrite', { todos: [] }).label, 'Updating the plan');
});

test('an unknown tool falls back to its own name, not something vague', () => {
  // The CLI gains tools over time; hiding which one behind "Working" would
  // hide exactly the information this exists to show.
  assert.equal(describeToolCall('SomeNewTool', {}).label, 'SomeNewTool');
  assert.equal(describeToolCall('SomeNewTool', {}).icon, 'activity');
});

test('missing or malformed input never throws', () => {
  assert.doesNotThrow(() => describeToolCall('Read', undefined));
  assert.doesNotThrow(() => describeToolCall('Read', null));
  assert.doesNotThrow(() => describeToolCall('Bash', 'not an object'));
  assert.doesNotThrow(() => describeToolCall('', {}));
  assert.doesNotThrow(() => describeToolCall(undefined, {}));
  assert.equal(describeToolCall(undefined, {}).label, 'Working');
});

test('every tool in the design doc\'s mapping table has an icon', () => {
  const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task', 'WebSearch',
    'WebFetch', 'TodoWrite'];
  for (const t of tools) {
    const { icon } = describeToolCall(t, {});
    assert.notEqual(icon, 'activity', `${t} should have its own icon, not the fallback`);
  }
});
