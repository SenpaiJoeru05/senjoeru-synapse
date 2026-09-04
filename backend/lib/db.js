/**
 * SQLite bootstrap + migration runner for SenJoeru Synapse.
 *
 * Per ARCHITECTURE-V2: SQLite is the PERMANENT source of truth for
 * Synapse-owned business data. It is NOT runtime cache (that stays in
 * metrics/*.json). This module opens the database, applies pending migrations
 * deterministically, and hands back a live connection.
 *
 * Uses better-sqlite3 (synchronous, zero-config, ACID) — the right fit for a
 * local desktop app.
 */
const path = require('path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');

// Permanent data — deliberately NOT under metrics/ (which is disposable cache).
// Overridable via env for tests / packaged builds (e.g. Electron userData dir).
const DEFAULT_DB_PATH = path.join(__dirname, '../data/synapse.db');

/**
 * Ordered migration list. Each migration runs exactly once, tracked in the
 * schema_migrations table. Append new migrations — never edit an applied one.
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'init_tasks',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id                TEXT PRIMARY KEY,
          title             TEXT,
          assigned_agent    TEXT,
          status            TEXT,
          progress          INTEGER DEFAULT 0,
          priority          TEXT,
          eta               TEXT,
          notes             TEXT,
          repos_json        TEXT,            -- JSON array of repo objects
          source            TEXT,            -- e.g. 'claude-tasks'
          task_last_updated TEXT,            -- lastUpdated as authored in tasks.json
          content_hash      TEXT NOT NULL,   -- change-detection fingerprint
          present_in_board  INTEGER DEFAULT 1, -- 0 once removed from tasks.json
          first_seen_at     TEXT NOT NULL,
          updated_at        TEXT NOT NULL
        );

        -- Append-only history: one row per distinct state a task has ever had.
        CREATE TABLE IF NOT EXISTS task_history (
          history_id        INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id           TEXT NOT NULL,
          title             TEXT,
          assigned_agent    TEXT,
          status            TEXT,
          progress          INTEGER,
          priority          TEXT,
          eta               TEXT,
          notes             TEXT,
          repos_json        TEXT,
          task_last_updated TEXT,
          content_hash      TEXT NOT NULL,
          captured_at       TEXT NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id)
        );

        CREATE INDEX IF NOT EXISTS idx_task_history_task_id
          ON task_history(task_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent);
      `);
    },
  },
  {
    version: 2,
    name: 'core_entities',
    up: (db) => {
      db.exec(`
        -- Workspace → Projects → Repositories (relational core).
        CREATE TABLE IF NOT EXISTS workspaces (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL UNIQUE,
          description TEXT,
          is_default  INTEGER DEFAULT 0,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER,
          name         TEXT NOT NULL,
          description  TEXT,
          status       TEXT DEFAULT 'active',   -- active | archived
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_ws_name
          ON projects(workspace_id, name);

        CREATE TABLE IF NOT EXISTS repositories (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id  INTEGER,
          name        TEXT NOT NULL,
          path        TEXT,
          branch      TEXT,
          provider    TEXT,                     -- e.g. github, local
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_name_path
          ON repositories(name, path);

        -- Key/value application settings (persistent — NOT runtime cache).
        CREATE TABLE IF NOT EXISTS settings (
          key        TEXT PRIMARY KEY,
          value      TEXT,                       -- JSON-encoded value
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 3,
    name: 'analytics_and_history',
    up: (db) => {
      db.exec(`
        -- Per-day token usage. Unbounded history (tokens.json keeps only 7 days).
        CREATE TABLE IF NOT EXISTS token_history (
          bucket_date TEXT PRIMARY KEY,   -- 'YYYY-MM-DD'
          tokens      INTEGER,
          cost        REAL,
          updated_at  TEXT NOT NULL
        );

        -- Per-day cost history (kept separate per the Phase-1 table list).
        CREATE TABLE IF NOT EXISTS cost_history (
          bucket_date TEXT PRIMARY KEY,   -- 'YYYY-MM-DD'
          cost        REAL,
          updated_at  TEXT NOT NULL
        );

        -- General engineering metrics time-series: one row per (metric, day).
        CREATE TABLE IF NOT EXISTS analytics (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          metric_key      TEXT NOT NULL,   -- e.g. agents_working, tasks_completed
          metric_value    REAL,
          bucket_date     TEXT NOT NULL,   -- 'YYYY-MM-DD'
          dimensions_json TEXT,
          updated_at      TEXT NOT NULL,
          UNIQUE(metric_key, bucket_date)
        );

        -- Append-only, immutable record of significant completed events.
        CREATE TABLE IF NOT EXISTS execution_history (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type  TEXT NOT NULL,       -- task_completed | git_commit
          entity_id   TEXT,                -- task id / repo name
          title       TEXT,
          detail      TEXT,
          dedupe_key  TEXT UNIQUE,         -- idempotency guard
          occurred_at TEXT,               -- best-effort real event time
          recorded_at TEXT NOT NULL        -- when persisted
        );

        CREATE INDEX IF NOT EXISTS idx_analytics_key ON analytics(metric_key);
        CREATE INDEX IF NOT EXISTS idx_exec_type ON execution_history(event_type);
        CREATE INDEX IF NOT EXISTS idx_exec_recorded ON execution_history(recorded_at);
      `);
    },
  },
  {
    version: 4,
    name: 'observation',
    up: (db) => {
      db.exec(`
        -- Repo state over time. One row appended only when a repo's state
        -- changes (dedup via state_hash) → a clean history, not a row per poll.
        CREATE TABLE IF NOT EXISTS repo_snapshots (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          repo_name      TEXT NOT NULL,
          branch         TEXT,
          tracking       TEXT,
          ahead          INTEGER,
          behind         INTEGER,
          modified_count INTEGER,
          staged_count   INTEGER,
          state_hash     TEXT NOT NULL,
          captured_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_repo_snapshots_name ON repo_snapshots(repo_name);

        -- Claude sessions seen in .claude/sessions, with history. Upsert by
        -- session_id; marked ended when it disappears (mirrors tasks pattern).
        CREATE TABLE IF NOT EXISTS observed_sessions (
          session_id    TEXT PRIMARY KEY,
          pid           INTEGER,
          cwd           TEXT,
          repo          TEXT,
          kind          TEXT,
          version       TEXT,
          started_at    TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at  TEXT NOT NULL,
          ended_at      TEXT,
          active        INTEGER DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_observed_sessions_active ON observed_sessions(active);

        -- Agent working-state timeline. One row appended only on change.
        CREATE TABLE IF NOT EXISTS agent_activity (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name  TEXT NOT NULL,
          status      TEXT,
          active_cwd  TEXT,
          state_hash  TEXT NOT NULL,
          captured_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_activity_name ON agent_activity(agent_name);
      `);
    },
  },
  {
    version: 5,
    name: 'agent_profiles',
    up: (db) => {
      db.exec(`
        -- Persona/profile for each Claude agent, imported (read-only) from the
        -- .claude/agents/*.md frontmatter. Keyed by the wiring slug; carries the
        -- human displayName + title for the Team view.
        CREATE TABLE IF NOT EXISTS agent_profiles (
          slug          TEXT PRIMARY KEY,   -- e.g. backend-engineer
          display_name  TEXT,               -- e.g. Miguel Santos
          title         TEXT,               -- e.g. Senior Backend Engineer
          role_name     TEXT,               -- formatted role, e.g. Backend Engineer
          description   TEXT,
          model         TEXT,
          first_seen_at TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 6,
    name: 'agent_memory',
    up: (db) => {
      db.exec(`
        -- Stored copy of each agent's *.memory.md (Claude-authored; Synapse
        -- observes it read-only for the Team view + future search).
        CREATE TABLE IF NOT EXISTS agent_memory (
          slug        TEXT PRIMARY KEY,   -- e.g. backend-engineer
          content     TEXT,
          char_count  INTEGER,
          updated_at  TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 7,
    name: 'knowledge',
    up: (db) => {
      db.exec(`
        -- Engineering knowledge you author (Synapse-owned, permanent).
        CREATE TABLE IF NOT EXISTS notes (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          title      TEXT NOT NULL,
          body       TEXT,
          category   TEXT,               -- e.g. decision | adr | note
          tags       TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          label      TEXT NOT NULL,
          url        TEXT,
          note       TEXT,
          created_at TEXT NOT NULL
        );

        -- Read-only index of markdown docs found in the monitored repos.
        CREATE TABLE IF NOT EXISTS doc_index (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          repo       TEXT NOT NULL,
          rel_path   TEXT NOT NULL,
          title      TEXT,
          headings   TEXT,
          size       INTEGER,
          indexed_at TEXT NOT NULL,
          UNIQUE(repo, rel_path)
        );
      `);
    },
  },
];

// ─── C1: Data safety — back up the DB before migrations / on startup ──────────
const MAX_BACKUPS = 15;
const BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000; // avoid spam on frequent restarts

function backupDatabase(db, dbPath) {
  if (dbPath === ':memory:') return;
  try {
    const backupsDir = path.join(path.dirname(dbPath), 'backups');
    fs.ensureDirSync(backupsDir);

    const existing = fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith('synapse-') && f.endsWith('.db'))
      .sort();

    // Skip if a very recent backup already exists (e.g. nodemon reload).
    if (existing.length) {
      const newest = existing[existing.length - 1];
      const ageMs = Date.now() - fs.statSync(path.join(backupsDir, newest)).mtimeMs;
      if (ageMs < BACKUP_MIN_INTERVAL_MS) return;
    }

    db.pragma('wal_checkpoint(TRUNCATE)'); // flush WAL so the copy is consistent
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dbPath, path.join(backupsDir, `synapse-${stamp}.db`));

    // Prune to the most recent MAX_BACKUPS.
    const after = fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith('synapse-') && f.endsWith('.db'))
      .sort();
    while (after.length > MAX_BACKUPS) {
      const oldest = after.shift();
      try { fs.removeSync(path.join(backupsDir, oldest)); } catch (_) {}
    }
    console.log('[db] backup written to data/backups/');
  } catch (err) {
    console.error('[db] backup failed (non-fatal):', err.message);
  }
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      record.run(m.version, m.name, new Date().toISOString());
    });
    tx();
    console.log(`[db] migration ${m.version} (${m.name}) applied`);
  }
}

/**
 * Open (or create) the database and apply migrations.
 * @param {string} [dbPath] - override path; use ':memory:' for tests.
 */
function openDatabase(dbPath = process.env.SYNAPSE_DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.ensureDirSync(path.dirname(dbPath));
  }
  // A pre-existing DB is backed up BEFORE migrations run (C1 data safety) so a
  // bad migration can never lose data.
  const preexisting = dbPath !== ':memory:' && fs.existsSync(dbPath);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');   // better concurrency + durability
  db.pragma('foreign_keys = ON');
  if (preexisting) backupDatabase(db, dbPath);
  runMigrations(db);
  return db;
}

module.exports = { openDatabase, MIGRATIONS, DEFAULT_DB_PATH, backupDatabase };
