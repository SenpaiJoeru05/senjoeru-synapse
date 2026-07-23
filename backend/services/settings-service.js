/**
 * SettingsService — SQLite is the source of truth for application settings
 * (per ARCHITECTURE-V2: User Settings are persistent, not runtime cache).
 *
 * The collector process reads `metrics/config.json` directly for its operational
 * config (pollInterval, repositories) and sits BELOW the data layer, so it must
 * not query SQLite. To keep the collector working with ZERO changes, this
 * service MIRRORS settings to config.json on every save — config.json becomes a
 * generated cache written by the owner (Synapse), never the source of truth.
 */
const fs = require('fs-extra');

const DEFAULTS = {
  claudeDir: 'C:\\Users\\joelr\\.claude',
  pollInterval: 30,
  monitorClaudeDir: true,
  repositories: [],
  autoRefresh: true,
  notifications: false,
  hourlyBudget: 5,
  weeklyBudget: 50,
};

class SettingsService {
  /**
   * @param {import('../repositories/settings-repository').SettingsRepository} repo
   * @param {string} configMirrorPath - absolute path to metrics/config.json
   */
  constructor(repo, configMirrorPath) {
    this.repo = repo;
    this.configMirrorPath = configMirrorPath;
  }

  /** Seed SQLite from an existing config.json exactly once (first run). */
  seedFromConfigIfEmpty() {
    if (!this.repo.isEmpty()) return false;
    let seed = { ...DEFAULTS };
    try {
      if (this.configMirrorPath && fs.existsSync(this.configMirrorPath)) {
        const existing = fs.readJsonSync(this.configMirrorPath);
        seed = { ...DEFAULTS, ...existing };
        delete seed.lastUpdated; // not a setting
      }
    } catch (_) { /* fall back to DEFAULTS */ }
    this.repo.setMany(seed, new Date().toISOString());
    return true;
  }

  /** Full settings object = defaults overlaid with stored values. */
  getAll() {
    return { ...DEFAULTS, ...this.repo.getAll() };
  }

  /** Merge a patch, persist to SQLite, then mirror to config.json for the collector. */
  save(patch) {
    const merged = { ...this.getAll(), ...(patch || {}) };

    // Light validation / coercion.
    if (typeof merged.pollInterval !== 'number' || merged.pollInterval < 5) {
      merged.pollInterval = Math.max(5, Number(merged.pollInterval) || DEFAULTS.pollInterval);
    }
    if (!Array.isArray(merged.repositories)) merged.repositories = [];

    this.repo.setMany(merged, new Date().toISOString());
    this._mirrorToConfig(merged);
    return merged;
  }

  _mirrorToConfig(settings) {
    if (!this.configMirrorPath) return;
    try {
      fs.writeJsonSync(
        this.configMirrorPath,
        { ...settings, lastUpdated: new Date().toISOString() },
        { spaces: 2 }
      );
    } catch (_) { /* mirror is best-effort; SQLite remains authoritative */ }
  }
}

module.exports = { SettingsService, SETTINGS_DEFAULTS: DEFAULTS };
