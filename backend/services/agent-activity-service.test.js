/**
 * Tests for AgentActivityService — the in-memory store behind
 * "what is a dispatched subagent doing right now", fed by Claude Code hooks.
 *
 * cd backend && node --test services/agent-activity-service.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AgentActivityService, defaultResolveRepo, configResolveRepo, DONE_TTL_MS,
} = require('./agent-activity-service');

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('SubagentStart creates a starting entry with the resolved repo', () => {
  const c = clock();
  const svc = new AgentActivityService({ now: c.now });
  svc.ingest({
    hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'frontend-engineer',
    session_id: 's1', cwd: 'D:\\work\\fsweb',
  });
  const [entry] = svc.snapshot();
  assert.equal(entry.agentId, 'a1');
  assert.equal(entry.agentType, 'frontend-engineer');
  assert.equal(entry.status, 'starting');
  assert.equal(entry.repo, 'fsweb'); // default resolver: basename of cwd
  assert.equal(entry.toolCallCount, 0);
  assert.equal(entry.current, null);
});

test('PreToolUse moves status to working and sets current', () => {
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1',
    tool_name: 'Read', tool_input: { file_path: '/r/src/App.vue' }, tool_use_id: 't1',
  });
  const [entry] = svc.snapshot();
  assert.equal(entry.status, 'working');
  assert.equal(entry.toolCallCount, 1);
  assert.equal(entry.current.tool, 'Read');
  assert.equal(entry.current.detail, 'Reading App.vue');
  assert.equal(entry.current.status, 'in-flight');
});

test('PostToolUse resolves the matching call and clears current', () => {
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1',
    tool_name: 'Read', tool_input: { file_path: '/r/a.ts' }, tool_use_id: 't1',
  });
  svc.ingest({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_use_id: 't1' });

  const [entry] = svc.snapshot();
  assert.equal(entry.current, null); // nothing in flight right now
  assert.equal(entry.recent.length, 1);
  assert.equal(entry.recent[0].status, 'done');
});

test('a failed tool call marks only that entry failed, not the whole subagent', () => {
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1',
    tool_name: 'Bash', tool_input: { command: 'exit 1' }, tool_use_id: 't1',
  });
  svc.ingest({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_use_id: 't1' });

  const [entry] = svc.snapshot();
  assert.equal(entry.status, 'working'); // NOT flipped to failed at the top level
  assert.equal(entry.recent[0].status, 'failed');
});

test('an older call resolving after a newer one started does not blank the newer action', () => {
  // Two overlapping tool calls: t1 starts, t2 starts, t1 resolves. `current`
  // must still point at t2 — the thing actually in flight now.
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1',
    tool_name: 'Read', tool_input: { file_path: '/r/a.ts' }, tool_use_id: 't1',
  });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1',
    tool_name: 'Grep', tool_input: { pattern: 'TODO' }, tool_use_id: 't2',
  });
  svc.ingest({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_use_id: 't1' });

  const [entry] = svc.snapshot();
  assert.equal(entry.current.tool, 'Grep');
});

test('the recent trail is capped at 5, oldest dropped first', () => {
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  for (let i = 0; i < 8; i++) {
    svc.ingest({
      hook_event_name: 'PreToolUse', agent_id: 'a1',
      tool_name: 'Read', tool_input: { file_path: `/r/f${i}.ts` }, tool_use_id: `t${i}`,
    });
  }
  const [entry] = svc.snapshot();
  assert.equal(entry.recent.length, 5);
  assert.equal(entry.toolCallCount, 8); // the COUNT is not capped, only the trail
  assert.equal(entry.recent[0].detail, 'Reading f3.ts'); // the oldest 3 fell off
  assert.equal(entry.recent[4].detail, 'Reading f7.ts');
});

test('SubagentStop marks done and carries the final message', () => {
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  svc.ingest({
    hook_event_name: 'SubagentStop', agent_id: 'a1',
    last_assistant_message: 'Verified 8/8 regression cases, no defects found.',
  });
  const [entry] = svc.snapshot();
  assert.equal(entry.status, 'done');
  assert.equal(entry.current, null);
  assert.equal(entry.lastMessage, 'Verified 8/8 regression cases, no defects found.');
});

test('two parallel agent_ids never cross-contaminate', () => {
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'frontend-engineer', cwd: '/fsweb' });
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'backend-engineer', cwd: '/fsweb' });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1',
    tool_name: 'Edit', tool_input: { file_path: '/fsweb/A.vue' }, tool_use_id: 'x1',
  });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a2',
    tool_name: 'Bash', tool_input: { command: 'php artisan test' }, tool_use_id: 'x2',
  });

  const byId = Object.fromEntries(svc.snapshot().map((e) => [e.agentId, e]));
  assert.equal(byId.a1.agentType, 'frontend-engineer');
  assert.equal(byId.a1.current.tool, 'Edit');
  assert.equal(byId.a2.agentType, 'backend-engineer');
  assert.equal(byId.a2.current.tool, 'Bash');
  // Neither's tool call count leaked into the other's.
  assert.equal(byId.a1.toolCallCount, 1);
  assert.equal(byId.a2.toolCallCount, 1);
});

test('an event with no agent_id is ignored — the parent thread is not a subagent', () => {
  // Hooks are configured globally, so the CALLING agent's own tool calls fire
  // PreToolUse/PostToolUse too, with no agent_id. Verified live before this
  // was written: the outer Task/Agent dispatch call itself carried none.
  const svc = new AgentActivityService();
  svc.ingest({
    hook_event_name: 'PreToolUse', tool_name: 'Read',
    tool_input: { file_path: '/x.ts' }, tool_use_id: 'p1',
    // no agent_id
  });
  assert.equal(svc.snapshot().length, 0);
});

test('malformed or unexpected events never throw', () => {
  const svc = new AgentActivityService();
  assert.doesNotThrow(() => svc.ingest(null));
  assert.doesNotThrow(() => svc.ingest(undefined));
  assert.doesNotThrow(() => svc.ingest({}));
  assert.doesNotThrow(() => svc.ingest('not an object'));
  assert.doesNotThrow(() => svc.ingest({ hook_event_name: 'SomeFutureEvent', agent_id: 'a1' }));
  // PostToolUse for a tool_use_id never seen (e.g. the Pre event was missed)
  // must not throw either.
  assert.doesNotThrow(() => svc.ingest({
    hook_event_name: 'PostToolUse', agent_id: 'a1', tool_use_id: 'never-seen',
  }));
});

test('a PreToolUse with no prior SubagentStart is adopted, not dropped', () => {
  // A missed start event (e.g. Synapse restarted mid-dispatch) must not hide
  // an otherwise genuinely active agent until it happens to finish.
  const svc = new AgentActivityService();
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'qa-engineer', cwd: '/r',
    tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 't1',
  });
  const [entry] = svc.snapshot();
  assert.equal(entry.agentType, 'qa-engineer');
  assert.equal(entry.status, 'working');
});

test('sweep removes a done entry only after its TTL, and only if done', () => {
  const c = clock();
  const svc = new AgentActivityService({ now: c.now });
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  svc.ingest({ hook_event_name: 'SubagentStop', agent_id: 'a1', last_assistant_message: 'ok' });
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'y', cwd: '/r' });
  // a2 is still 'starting', not done - must survive the sweep regardless of age.

  c.advance(DONE_TTL_MS - 1);
  svc.sweep();
  assert.equal(svc.snapshot().length, 2, 'not expired yet');

  c.advance(2);
  svc.sweep();
  const remaining = svc.snapshot();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].agentId, 'a2');
});

test('defaultResolveRepo takes the basename of whichever separator the path uses', () => {
  assert.equal(defaultResolveRepo('D:\\work\\fsweb'), 'fsweb');
  assert.equal(defaultResolveRepo('/home/joel/senjoeru-synapse'), 'senjoeru-synapse');
  assert.equal(defaultResolveRepo('D:\\work\\fsweb\\'), 'fsweb'); // trailing separator
  assert.equal(defaultResolveRepo(''), '');
  assert.equal(defaultResolveRepo(undefined), '');
});

test('configResolveRepo prefers an exact/ancestor match over the bare basename', () => {
  const cfg = () => ({ repoPaths: ['D:\\FlowerStore\\fsweb', 'D:\\Personal Works\\senjoeru-synapse'] });
  const resolve = configResolveRepo(cfg);

  assert.equal(resolve('D:\\FlowerStore\\fsweb'), 'fsweb');
  assert.equal(resolve('D:\\FlowerStore\\fsweb\\resources\\js'), 'fsweb');
  assert.equal(resolve('D:/FlowerStore/fsweb/resources'), 'fsweb'); // forward slashes too
  // An unrecognised path still renders as something, per its own basename.
  assert.equal(resolve('D:\\somewhere-else\\a-worktree'), 'a-worktree');
});

test('configResolveRepo prefers the LONGEST matching configured path', () => {
  // A nested repo path must not match its own parent instead of itself.
  const cfg = () => ({
    repoPaths: ['D:\\work', 'D:\\work\\nested-repo'],
  });
  const resolve = configResolveRepo(cfg);
  assert.equal(resolve('D:\\work\\nested-repo\\src'), 'nested-repo');
});

test('snapshot never leaks the internal _inFlight bookkeeping map', () => {
  const svc = new AgentActivityService();
  svc.ingest({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'x', cwd: '/r' });
  svc.ingest({
    hook_event_name: 'PreToolUse', agent_id: 'a1',
    tool_name: 'Read', tool_input: { file_path: '/r/a.ts' }, tool_use_id: 't1',
  });
  const json = JSON.stringify(svc.snapshot());
  assert.ok(!json.includes('_inFlight'), 'internal Map must not reach the wire');
});
