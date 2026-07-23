/**
 * RepositoryRepository — SQL for the repositories table (repo METADATA owned by
 * Synapse; the repo contents/history stay on disk + in Git).
 */
class RepositoryRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM repositories ORDER BY id ASC');
    this._byId = db.prepare('SELECT * FROM repositories WHERE id = ?');
    this._byNamePath = db.prepare('SELECT * FROM repositories WHERE name = ? AND path IS ?');
    this._byProject = db.prepare('SELECT * FROM repositories WHERE project_id = ? ORDER BY id ASC');
    this._insert = db.prepare(`
      INSERT INTO repositories (project_id, name, path, branch, provider, created_at, updated_at)
      VALUES (@project_id, @name, @path, @branch, @provider, @now, @now)
    `);
    this._update = db.prepare(`
      UPDATE repositories SET project_id = @project_id, name = @name, path = @path,
        branch = @branch, provider = @provider, updated_at = @now
      WHERE id = @id
    `);
  }

  getAll() { return this._all.all(); }
  getById(id) { return this._byId.get(id); }
  getByNameAndPath(name, path) { return this._byNamePath.get(name, path ?? null); }
  listByProject(projectId) { return this._byProject.all(projectId); }

  insert(row) { return this._insert.run(row).lastInsertRowid; }
  update(row) { this._update.run(row); }
}

module.exports = { RepositoryRepository };
