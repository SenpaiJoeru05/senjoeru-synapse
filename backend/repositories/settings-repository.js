/** SettingsRepository — SQL for the key/value settings table. */
class SettingsRepository {
  constructor(db) {
    this.db = db;
    this._all = db.prepare('SELECT key, value FROM settings');
    this._get = db.prepare('SELECT value FROM settings WHERE key = ?');
    this._set = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @now)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this._count = db.prepare('SELECT COUNT(*) AS n FROM settings');
  }

  /** Returns a plain object { key: parsedValue }. */
  getAll() {
    const out = {};
    for (const row of this._all.all()) {
      try { out[row.key] = JSON.parse(row.value); } catch (_) { out[row.key] = row.value; }
    }
    return out;
  }

  get(key) {
    const row = this._get.get(key);
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch (_) { return row.value; }
  }

  /** Upsert many keys from a plain object (values are JSON-encoded). */
  setMany(obj, now) {
    const tx = this.db.transaction((entries) => {
      for (const [key, value] of entries) {
        this._set.run({ key, value: JSON.stringify(value), now });
      }
    });
    tx(Object.entries(obj));
  }

  isEmpty() { return this._count.get().n === 0; }
}

module.exports = { SettingsRepository };
