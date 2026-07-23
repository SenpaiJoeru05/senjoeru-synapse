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
];

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
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');   // better concurrency + durability
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

module.exports = { openDatabase, MIGRATIONS, DEFAULT_DB_PATH };
