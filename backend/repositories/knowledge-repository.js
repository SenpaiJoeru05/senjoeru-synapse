/** Repositories for the Phase-4 knowledge tables: notes, bookmarks, doc_index. */

class NotesRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC');
    this._byId = db.prepare('SELECT * FROM notes WHERE id = ?');
    this._insert = db.prepare(`
      INSERT INTO notes (title, body, category, tags, created_at, updated_at)
      VALUES (@title, @body, @category, @tags, @now, @now)
    `);
    this._update = db.prepare(`
      UPDATE notes SET title = @title, body = @body, category = @category,
        tags = @tags, updated_at = @now WHERE id = @id
    `);
    this._delete = db.prepare('DELETE FROM notes WHERE id = ?');
  }
  getAll() { return this._all.all(); }
  getById(id) { return this._byId.get(id); }
  insert(row) { return this._insert.run(row).lastInsertRowid; }
  update(row) { this._update.run(row); }
  remove(id) { this._delete.run(id); }
}

class BookmarkRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC');
    this._insert = db.prepare(`
      INSERT INTO bookmarks (label, url, note, created_at)
      VALUES (@label, @url, @note, @now)
    `);
    this._delete = db.prepare('DELETE FROM bookmarks WHERE id = ?');
  }
  getAll() { return this._all.all(); }
  insert(row) { return this._insert.run(row).lastInsertRowid; }
  remove(id) { this._delete.run(id); }
}

class DocIndexRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT * FROM doc_index ORDER BY repo ASC, rel_path ASC');
    this._byRepo = db.prepare('SELECT * FROM doc_index WHERE repo = ? ORDER BY rel_path ASC');
    this._count = db.prepare('SELECT COUNT(*) AS n FROM doc_index');
    this._clear = db.prepare('DELETE FROM doc_index');
    this._upsert = db.prepare(`
      INSERT INTO doc_index (repo, rel_path, title, headings, size, indexed_at)
      VALUES (@repo, @rel_path, @title, @headings, @size, @now)
      ON CONFLICT(repo, rel_path) DO UPDATE SET
        title = excluded.title, headings = excluded.headings,
        size = excluded.size, indexed_at = excluded.indexed_at
    `);
  }
  getAll() { return this._all.all(); }
  getByRepo(repo) { return this._byRepo.all(repo); }
  count() { return this._count.get().n; }
  clear() { this._clear.run(); }
  upsert(row) { this._upsert.run(row); }
}

module.exports = { NotesRepository, BookmarkRepository, DocIndexRepository };
