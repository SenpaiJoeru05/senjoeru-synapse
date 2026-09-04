/** NotesService + BookmarkService — CRUD for Synapse-owned engineering knowledge. */

class NotesService {
  constructor(repo) { this.repo = repo; }

  list() { return this.repo.getAll(); }
  get(id) { return this.repo.getById(id); }

  create({ title, body = null, category = 'note', tags = null }) {
    if (!title || !String(title).trim()) throw new Error('Note title is required');
    const now = new Date().toISOString();
    const id = this.repo.insert({ title: String(title).trim(), body, category, tags, now });
    return this.repo.getById(id);
  }

  update(id, { title, body, category, tags }) {
    const existing = this.repo.getById(id);
    if (!existing) throw new Error('Note not found');
    this.repo.update({
      id,
      title: title != null ? String(title).trim() : existing.title,
      body: body != null ? body : existing.body,
      category: category != null ? category : existing.category,
      tags: tags != null ? tags : existing.tags,
      now: new Date().toISOString(),
    });
    return this.repo.getById(id);
  }

  remove(id) {
    if (!this.repo.getById(id)) throw new Error('Note not found');
    this.repo.remove(id);
  }
}

class BookmarkService {
  constructor(repo) { this.repo = repo; }
  list() { return this.repo.getAll(); }
  create({ label, url = null, note = null }) {
    if (!label || !String(label).trim()) throw new Error('Bookmark label is required');
    const id = this.repo.insert({ label: String(label).trim(), url, note, now: new Date().toISOString() });
    return this.repo.getAll().find((b) => b.id === id);
  }
  remove(id) { this.repo.remove(id); }
}

module.exports = { NotesService, BookmarkService };
