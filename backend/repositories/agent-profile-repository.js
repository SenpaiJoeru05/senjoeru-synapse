/** AgentProfileRepository — SQL for the agent_profiles table. */
class AgentProfileRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM agent_profiles ORDER BY role_name ASC');
    this._bySlug = db.prepare('SELECT * FROM agent_profiles WHERE slug = ?');
    this._upsert = db.prepare(`
      INSERT INTO agent_profiles
        (slug, display_name, title, role_name, description, model, first_seen_at, updated_at)
      VALUES (@slug, @display_name, @title, @role_name, @description, @model, @now, @now)
      ON CONFLICT(slug) DO UPDATE SET
        display_name = excluded.display_name,
        title        = excluded.title,
        role_name    = excluded.role_name,
        description  = excluded.description,
        model        = excluded.model,
        updated_at   = excluded.updated_at
    `);
  }

  getAll() { return this._all.all(); }
  getBySlug(slug) { return this._bySlug.get(slug); }
  upsert(row) { this._upsert.run(row); }
}

module.exports = { AgentProfileRepository };
