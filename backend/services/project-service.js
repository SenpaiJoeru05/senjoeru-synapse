/** ProjectService — business rules for projects. */
class ProjectService {
  constructor(repo) { this.repo = repo; }

  list() { return this.repo.getAll(); }
  get(id) { return this.repo.getById(id); }
  listByWorkspace(workspaceId) { return this.repo.listByWorkspace(workspaceId); }

  create({ workspaceId, name, description = null }) {
    if (!name || !String(name).trim()) throw new Error('Project name is required');
    if (!workspaceId) throw new Error('workspaceId is required');
    const trimmed = String(name).trim();
    if (this.repo.getByWorkspaceAndName(workspaceId, trimmed)) {
      throw new Error(`Project "${trimmed}" already exists in this workspace`);
    }
    const now = new Date().toISOString();
    const id = this.repo.insert({
      workspace_id: workspaceId, name: trimmed, description, status: 'active', now,
    });
    return this.repo.getById(id);
  }

  update(id, { name, description, status }) {
    const existing = this.repo.getById(id);
    if (!existing) throw new Error('Project not found');
    this.repo.update({
      id,
      name: name != null ? String(name).trim() : existing.name,
      description: description != null ? description : existing.description,
      status: status != null ? status : existing.status,
      now: new Date().toISOString(),
    });
    return this.repo.getById(id);
  }

  archive(id) { return this.update(id, { status: 'archived' }); }
}

module.exports = { ProjectService };
