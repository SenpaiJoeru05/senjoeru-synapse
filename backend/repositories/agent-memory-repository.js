/** AgentMemoryRepository — SQL for the agent_memory table. */
class AgentMemoryRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM agent_memory ORDER BY slug ASC');
    this._bySlug = db.prepare('SELECT * FROM agent_memory WHERE slug = ?');
    this._upsert = db.prepare(`
      INSERT INTO agent_memory (slug, content, char_count, updated_at)
      VALUES (@slug, @content, @char_count, @now)
      ON CONFLICT(slug) DO UPDATE SET
        content = excluded.content, char_count = excluded.char_count, updated_at = excluded.updated_at
    `);
  }

  getAll() { return this._all.all(); }
  getBySlug(slug) { return this._bySlug.get(slug); }
  upsert(row) { this._upsert.run(row); }
}

module.exports = { AgentMemoryRepository };
