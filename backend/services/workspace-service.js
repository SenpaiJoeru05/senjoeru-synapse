/** WorkspaceService — business rules for workspaces. */
class WorkspaceService {
  constructor(repo) { this.repo = repo; }

  list() { return this.repo.getAll(); }
  get(id) { return this.repo.getById(id); }

  create({ name, description = null, isDefault = false }) {
    if (!name || !String(name).trim()) throw new Error('Workspace name is required');
    const trimmed = String(name).trim();
    if (this.repo.getByName(trimmed)) throw new Error(`Workspace "${trimmed}" already exists`);
    const now = new Date().toISOString();
    const id = this.repo.insert({
      name: trimmed, description, is_default: isDefault ? 1 : 0, now,
    });
    return this.repo.getById(id);
  }

  update(id, { name, description }) {
    const existing = this.repo.getById(id);
    if (!existing) throw new Error('Workspace not found');
    this.repo.update({
      id,
      name: name != null ? String(name).trim() : existing.name,
      description: description != null ? description : existing.description,
      now: new Date().toISOString(),
    });
    return this.repo.getById(id);
  }

  /** Ensure a single default workspace exists; return it. */
  ensureDefault() {
    let ws = this.repo.getDefault();
    if (ws) return ws;
    const now = new Date().toISOString();
    const id = this.repo.insert({
      name: 'Default', description: 'Default workspace', is_default: 1, now,
    });
    return this.repo.getById(id);
  }
}

module.exports = { WorkspaceService };
