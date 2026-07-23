/**
 * AnalyticsRepository — SQL for the historical tables:
 * token_history, cost_history, analytics, execution_history.
 */
class AnalyticsRepository {
  constructor(db) {
    this.db = db;

    this._upsertToken = db.prepare(`
      INSERT INTO token_history (bucket_date, tokens, cost, updated_at)
      VALUES (@bucket_date, @tokens, @cost, @now)
      ON CONFLICT(bucket_date) DO UPDATE SET
        tokens = excluded.tokens, cost = excluded.cost, updated_at = excluded.updated_at
    `);
    this._tokenHistory = db.prepare('SELECT * FROM token_history ORDER BY bucket_date ASC');

    this._upsertCost = db.prepare(`
      INSERT INTO cost_history (bucket_date, cost, updated_at)
      VALUES (@bucket_date, @cost, @now)
      ON CONFLICT(bucket_date) DO UPDATE SET
        cost = excluded.cost, updated_at = excluded.updated_at
    `);
    this._costHistory = db.prepare('SELECT * FROM cost_history ORDER BY bucket_date ASC');

    this._upsertMetric = db.prepare(`
      INSERT INTO analytics (metric_key, metric_value, bucket_date, dimensions_json, updated_at)
      VALUES (@metric_key, @metric_value, @bucket_date, @dimensions_json, @now)
      ON CONFLICT(metric_key, bucket_date) DO UPDATE SET
        metric_value = excluded.metric_value,
        dimensions_json = excluded.dimensions_json,
        updated_at = excluded.updated_at
    `);
    this._metricsAll = db.prepare('SELECT * FROM analytics ORDER BY bucket_date ASC, metric_key ASC');
    this._metricsByKey = db.prepare(
      'SELECT * FROM analytics WHERE metric_key = ? ORDER BY bucket_date ASC'
    );

    // INSERT OR IGNORE makes execution recording idempotent via dedupe_key.
    this._insertExec = db.prepare(`
      INSERT OR IGNORE INTO execution_history
        (event_type, entity_id, title, detail, dedupe_key, occurred_at, recorded_at)
      VALUES (@event_type, @entity_id, @title, @detail, @dedupe_key, @occurred_at, @now)
    `);
    this._execRecent = db.prepare(
      'SELECT * FROM execution_history ORDER BY recorded_at DESC, id DESC LIMIT ?'
    );
    this._execCount = db.prepare('SELECT COUNT(*) AS n FROM execution_history');
  }

  upsertTokenDay(row) { this._upsertToken.run(row); }
  getTokenHistory() { return this._tokenHistory.all(); }

  upsertCostDay(row) { this._upsertCost.run(row); }
  getCostHistory() { return this._costHistory.all(); }

  upsertMetric(row) { this._upsertMetric.run(row); }
  getMetrics(key) { return key ? this._metricsByKey.all(key) : this._metricsAll.all(); }

  /** Returns true if a new row was inserted (false if dedupe_key already existed). */
  insertExecutionIfNew(row) { return this._insertExec.run(row).changes > 0; }
  getExecutionHistory(limit = 50) { return this._execRecent.all(limit); }
  executionCount() { return this._execCount.get().n; }
}

module.exports = { AnalyticsRepository };
