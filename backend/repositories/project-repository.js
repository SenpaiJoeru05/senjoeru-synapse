/** ProjectRepository — SQL for the projects table. */
class ProjectRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM projects ORDER BY id ASC');
    this._byId = db.prepare('SELECT * FROM projects WHERE id = ?');
    this._byWsName = db.prepare('SELECT * FROM projects WHERE workspace_id = ? AND name = ?');
    this._byWorkspace = db.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY id ASC');
    this._insert = db.prepare(`
      INSERT INTO projects (workspace_id, name, description, status, created_at, updated_at)
      VALUES (@workspace_id, @name, @description, @status, @now, @now)
    `);
    this._update = db.prepare(`
      UPDATE projects SET name = @name, description = @description, status = @status, updated_at = @now
      WHERE id = @id
    `);
  }

  getAll() { return this._all.all(); }
  getById(id) { return this._byId.get(id); }
  getByWorkspaceAndName(workspaceId, name) { return this._byWsName.get(workspaceId, name); }
  listByWorkspace(workspaceId) { return this._byWorkspace.all(workspaceId); }

  insert(row) { return this._insert.run(row).lastInsertRowid; }
  update(row) { this._update.run(row); }
}

module.exports = { ProjectRepository };
