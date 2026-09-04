/**
 * SearchService — Phase 4.4 keyword search across all local knowledge:
 * notes, docs, tasks, agent memory, execution history.
 *
 * Uses SQLite FTS5 (local, free, NO embeddings/RAG). The index is rebuilt from
 * the source tables on each search — our data is small, so this is always-fresh
 * and simple. Degrades to a LIKE scan if FTS5 isn't available in the build.
 */
class SearchService {
  constructor(db) {
    this.db = db;
    this.ftsOk = this._initFts();
  }

  _initFts() {
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_fts
                    USING fts5(kind, ref, title, content)`);
      return true;
    } catch (_) {
      return false; // FTS5 not compiled in → LIKE fallback
    }
  }

  /** Gather searchable rows from every source table. */
  _rows() {
    const rows = [];
    const push = (kind, ref, title, content) => rows.push({ kind, ref: String(ref), title: title || '', content: content || '' });
    const q = (sql) => { try { return this.db.prepare(sql).all(); } catch (_) { return []; } };

    for (const n of q('SELECT id, title, body, category, tags FROM notes'))
      push('note', n.id, n.title, `${n.body || ''} ${n.category || ''} ${n.tags || ''}`);
    for (const d of q('SELECT id, repo, rel_path, title, headings FROM doc_index'))
      push('doc', d.id, d.title || d.rel_path, `${d.repo} ${d.rel_path} ${d.headings || ''}`);
    for (const t of q("SELECT id, title, notes, status, assigned_agent FROM tasks WHERE present_in_board = 1"))
      push('task', t.id, t.title, `${t.notes || ''} ${t.status || ''} ${t.assigned_agent || ''}`);
    for (const m of q('SELECT slug, content FROM agent_memory'))
      push('memory', m.slug, m.slug, m.content);
    for (const e of q('SELECT id, title, detail, event_type FROM execution_history ORDER BY id DESC LIMIT 500'))
      push('event', e.id, e.title, `${e.detail || ''} ${e.event_type}`);

    return rows;
  }

  _rebuild(rows) {
    if (!this.ftsOk) return;
    const ins = this.db.prepare('INSERT INTO search_fts (kind, ref, title, content) VALUES (?, ?, ?, ?)');
    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM search_fts');
      for (const r of rows) ins.run(r.kind, r.ref, r.title, r.content);
    });
    tx();
  }

  /** @param {string} query @param {{limit?:number, kind?:string}} [opts] */
  search(query, opts = {}) {
    const q = String(query || '').trim();
    if (!q) return { query: '', results: [], engine: this.ftsOk ? 'fts5' : 'like' };
    const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 200);

    const rows = this._rows();
    this._rebuild(rows);

    if (this.ftsOk) {
      // Build a safe FTS5 MATCH: prefix-match each bare term.
      const match = q.split(/\s+/).filter(Boolean)
        .map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
      let sql = `SELECT kind, ref, title,
                   snippet(search_fts, 3, '[', ']', '…', 12) AS snippet
                 FROM search_fts WHERE search_fts MATCH ?`;
      const params = [match];
      if (opts.kind) { sql += ' AND kind = ?'; params.push(opts.kind); }
      sql += ' LIMIT ?'; params.push(limit);
      try {
        return { query: q, engine: 'fts5', results: this.db.prepare(sql).all(...params) };
      } catch (_) { /* fall through to LIKE */ }
    }

    // LIKE fallback (also covers a malformed FTS query).
    const needle = q.toLowerCase();
    const results = rows
      .filter((r) => (!opts.kind || r.kind === opts.kind) &&
        (r.title.toLowerCase().includes(needle) || r.content.toLowerCase().includes(needle)))
      .slice(0, limit)
      .map((r) => ({ kind: r.kind, ref: r.ref, title: r.title, snippet: r.content.slice(0, 140) }));
    return { query: q, engine: 'like', results };
  }
}

module.exports = { SearchService };
