/** RepositoryService — business rules for repository metadata. */
class RepositoryService {
  constructor(repo) { this.repo = repo; }

  list() { return this.repo.getAll(); }
  get(id) { return this.repo.getById(id); }
  listByProject(projectId) { return this.repo.listByProject(projectId); }

  /**
   * Register a repo (idempotent by name+path — re-registering updates metadata
   * instead of duplicating). Returns the row.
   */
  register({ projectId = null, name, path = null, branch = null, provider = null }) {
    if (!name || !String(name).trim()) throw new Error('Repository name is required');
    const trimmed = String(name).trim();
    const now = new Date().toISOString();

    const existing = this.repo.getByNameAndPath(trimmed, path);
    if (existing) {
      this.repo.update({
        id: existing.id,
        project_id: projectId != null ? projectId : existing.project_id,
        name: trimmed,
        path: path != null ? path : existing.path,
        branch: branch != null ? branch : existing.branch,
        provider: provider != null ? provider : existing.provider,
        now,
      });
      return this.repo.getById(existing.id);
    }
    const id = this.repo.insert({
      project_id: projectId, name: trimmed, path, branch, provider, now,
    });
    return this.repo.getById(id);
  }

  update(id, patch) {
    const existing = this.repo.getById(id);
    if (!existing) throw new Error('Repository not found');
    this.repo.update({
      id,
      project_id: patch.projectId != null ? patch.projectId : existing.project_id,
      name: patch.name != null ? String(patch.name).trim() : existing.name,
      path: patch.path != null ? patch.path : existing.path,
      branch: patch.branch != null ? patch.branch : existing.branch,
      provider: patch.provider != null ? patch.provider : existing.provider,
      now: new Date().toISOString(),
    });
    return this.repo.getById(id);
  }
}

module.exports = { RepositoryService };
