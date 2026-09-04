/**
 * DocIndexService — read-only index of markdown docs in the monitored repos
 * (Phase 4.2). Never edits files; stores path/title/headings for browse + search.
 * Bounded (excludes heavy dirs, caps total files) so it stays fast.
 */
const path = require('path');
const fs = require('fs-extra');

const EXCLUDE_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'storage', 'coverage',
  '.next', '.nuxt', 'public', '.git', 'bootstrap',
]);
const MAX_FILES = 600;

function walkMd(root, cap, acc) {
  if (acc.length >= cap) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (acc.length >= cap) return;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walkMd(path.join(root, e.name), cap, acc);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      acc.push(path.join(root, e.name));
    }
  }
}

function extract(content) {
  const lines = content.split(/\r?\n/);
  let title = null;
  const headings = [];
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      if (!title) title = m[2].trim();
      headings.push(m[2].trim());
      if (headings.length >= 30) break;
    }
  }
  return { title, headings: headings.join(' · ').slice(0, 500) };
}

class DocIndexService {
  /**
   * @param {import('../repositories/knowledge-repository').DocIndexRepository} repo
   * @param {string} metricsDir - to read config.json for the repo list
   */
  constructor(repo, metricsDir) {
    this.repo = repo;
    this.metricsDir = metricsDir;
  }

  _repoPaths() {
    try {
      const cfg = fs.readJsonSync(path.join(this.metricsDir, 'config.json'));
      return Array.isArray(cfg.repositories) ? cfg.repositories : [];
    } catch (_) { return []; }
  }

  /** Full rebuild of the docs index from the monitored repos. */
  reindex() {
    const now = new Date().toISOString();
    let indexed = 0;
    this.repo.clear();
    for (const repoPath of this._repoPaths()) {
      if (!fs.existsSync(repoPath)) continue;
      const repoName = path.basename(repoPath);
      const files = [];
      walkMd(repoPath, MAX_FILES, files);
      for (const file of files) {
        let content = '';
        try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
        const { title, headings } = extract(content);
        const relPath = path.relative(repoPath, file).replace(/\\/g, '/');
        this.repo.upsert({
          repo: repoName, rel_path: relPath,
          title: title || relPath, headings,
          size: content.length, now,
        });
        indexed++;
      }
    }
    return { indexed };
  }

  /** Index once if empty (keeps startup fast on restarts). */
  reindexIfEmpty() {
    if (this.repo.count() === 0) return this.reindex();
    return { indexed: 0, skipped: true };
  }
}

module.exports = { DocIndexService };
