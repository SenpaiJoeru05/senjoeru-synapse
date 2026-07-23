/** WorkspaceRepository — SQL for the workspaces table. */
class WorkspaceRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM workspaces ORDER BY id ASC');
    this._byId = db.prepare('SELECT * FROM workspaces WHERE id = ?');
    this._byName = db.prepare('SELECT * FROM workspaces WHERE name = ?');
    this._default = db.prepare('SELECT * FROM workspaces WHERE is_default = 1 LIMIT 1');
    this._insert = db.prepare(`
      INSERT INTO workspaces (name, description, is_default, created_at, updated_at)
      VALUES (@name, @description, @is_default, @now, @now)
    `);
    this._update = db.prepare(`
      UPDATE workspaces SET name = @name, description = @description, updated_at = @now
      WHERE id = @id
    `);
  }

  getAll() { return this._all.all(); }
  getById(id) { return this._byId.get(id); }
  getByName(name) { return this._byName.get(name); }
  getDefault() { return this._default.get(); }

  insert(row) { return this._insert.run(row).lastInsertRowid; }
  update(row) { this._update.run(row); }
}

module.exports = { WorkspaceRepository };
