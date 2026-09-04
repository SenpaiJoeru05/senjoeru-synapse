/**
 * TeamService — the AI engineering team view (Phase 4 / Track B).
 *
 * Reads `.claude/agents/*.md` (personas) and `*.memory.md` (accumulated memory)
 * DIRECTLY — read-only, no collector dependency, so the Team page is always
 * fresh. Also stores memory into SQLite (agent_memory) for permanence + future
 * search. Observer-only; the agents own these files.
 */
const path = require('path');
const fs = require('fs-extra');

const ACRONYMS = new Set(['ai', 'db', 'qa', 'cs']);
function roleFromSlug(slug) {
  return String(slug).split('-')
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > -1) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

class TeamService {
  /**
   * @param {string} agentsDir - absolute path to .claude/agents
   * @param {import('../repositories/agent-memory-repository').AgentMemoryRepository} memoryRepo
   */
  constructor(agentsDir, memoryRepo) {
    this.agentsDir = agentsDir;
    this.memoryRepo = memoryRepo;
  }

  /** Live team = persona (from *.md) + memory (from *.memory.md), fresh each call. */
  getTeam() {
    let files = [];
    try {
      files = fs.readdirSync(this.agentsDir)
        .filter((f) => f.endsWith('.md') && !f.endsWith('.memory.md'));
    } catch (_) { return []; }

    const team = [];
    for (const f of files) {
      let content;
      try { content = fs.readFileSync(path.join(this.agentsDir, f), 'utf8'); } catch (_) { continue; }
      const fm = parseFrontmatter(content);
      const slug = fm.name || path.basename(f, '.md');

      // Memory now lives in agents/memory/<slug>.memory.md; fall back to the
      // legacy flat location (agents/<slug>.memory.md) for back-compat.
      let memory = null;
      try {
        const candidates = [
          path.join(this.agentsDir, 'memory', `${slug}.memory.md`),
          path.join(this.agentsDir, `${slug}.memory.md`),
        ];
        for (const mp of candidates) {
          if (fs.existsSync(mp)) { memory = fs.readFileSync(mp, 'utf8'); break; }
        }
      } catch (_) { /* no memory */ }

      team.push({
        slug,
        displayName: fm.displayName || null,
        title: fm.title || roleFromSlug(slug),
        roleName: roleFromSlug(slug),
        model: fm.model || null,
        description: fm.description || null,
        memory,
        memoryChars: memory ? memory.length : 0,
      });
    }
    team.sort((a, b) => (a.displayName || a.roleName).localeCompare(b.displayName || b.roleName));
    return team;
  }

  /** Persist each agent's memory into SQLite (permanent copy). Idempotent. */
  syncMemory() {
    const now = new Date().toISOString();
    let synced = 0;
    for (const a of this.getTeam()) {
      if (a.memory == null) continue;
      this.memoryRepo.upsert({ slug: a.slug, content: a.memory, char_count: a.memoryChars, now });
      synced++;
    }
    return { synced };
  }
}

module.exports = { TeamService, roleFromSlug, parseFrontmatter };
