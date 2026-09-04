/**
 * Tests for TeamService — reading agent personas + memory from .claude/agents.
 *   cd backend && node --test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabase } = require('../lib/db');
const { AgentMemoryRepository } = require('../repositories/agent-memory-repository');
const { TeamService, roleFromSlug } = require('./team-service');

function setup(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-team-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  const db = openDatabase(':memory:');
  const memoryRepo = new AgentMemoryRepository(db);
  return { dir, db, memoryRepo, svc: new TeamService(dir, memoryRepo) };
}

const AGENT_MD = (name, extra = '') =>
  `---\nname: ${name}\n${extra}description: does ${name} things\ntools: Read\nmodel: sonnet\n---\nBody.`;

test('getTeam merges persona + memory, excludes *.memory.md from the roster', () => {
  const { svc } = setup({
    'backend-engineer.md': AGENT_MD('backend-engineer', 'displayName: Miguel Santos\ntitle: Senior Backend Engineer\n'),
    'backend-engineer.memory.md': '# mem\n- a durable gotcha',
    'project-manager.md': AGENT_MD('project-manager', 'displayName: Rafael Cruz\ntitle: Project Manager\n'),
  });
  const team = svc.getTeam();
  assert.equal(team.length, 2); // the .memory.md is NOT a roster entry
  const bySlug = Object.fromEntries(team.map((m) => [m.slug, m]));
  assert.equal(bySlug['backend-engineer'].displayName, 'Miguel Santos');
  assert.ok(bySlug['backend-engineer'].memory.includes('durable gotcha'));
  assert.ok(bySlug['backend-engineer'].memoryChars > 0);
  assert.equal(bySlug['project-manager'].memory, null); // no memory file
});

test('title falls back to a formatted role when frontmatter lacks one', () => {
  const { svc } = setup({ 'db-admin.md': AGENT_MD('db-admin') });
  assert.equal(svc.getTeam()[0].title, 'DB Admin'); // roleFromSlug keeps acronyms
});

test('syncMemory persists only agents that have a memory file', () => {
  const { svc, memoryRepo } = setup({
    'backend-engineer.md': AGENT_MD('backend-engineer'),
    'backend-engineer.memory.md': '- one line',
    'qa-engineer.md': AGENT_MD('qa-engineer'),
  });
  assert.equal(svc.syncMemory().synced, 1);
  assert.equal(memoryRepo.getAll().length, 1);
  assert.ok(memoryRepo.getBySlug('backend-engineer').content.includes('one line'));
  assert.equal(memoryRepo.getBySlug('qa-engineer'), undefined);
});

test('roleFromSlug title-cases and preserves acronyms', () => {
  assert.equal(roleFromSlug('ai-chatbot-engineer'), 'AI Chatbot Engineer');
  assert.equal(roleFromSlug('cs-comms-writer'), 'CS Comms Writer');
});
