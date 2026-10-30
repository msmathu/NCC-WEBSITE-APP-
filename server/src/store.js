// Persistent cadet profiles and leaderboard, stored in a single SQLite file
// using Node's built-in node:sqlite (no native build, no hosted database).
import { DatabaseSync } from 'node:sqlite';
import { DIRECTORATES, RANKS, UNLOCKS, rankIndexFor } from './course.js';

export class Store {
  constructor(file = 'data/ncc.db') {
    /** Called with a device id after that cadet changes (used by PgMirror). */
    this.onChange = null;
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cadets (
        device_id   TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        directorate TEXT NOT NULL,
        dp          INTEGER NOT NULL DEFAULT 0,
        races       INTEGER NOT NULL DEFAULT 0,
        wins        INTEGER NOT NULL DEFAULT 0,
        best_ms     INTEGER,
        uniform     TEXT NOT NULL DEFAULT 'army',
        beret       TEXT NOT NULL DEFAULT 'maroon',
        badge       TEXT NOT NULL DEFAULT 'none',
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cadets_dir ON cadets(directorate);
      CREATE INDEX IF NOT EXISTS cadets_dp ON cadets(dp DESC);
    `);
    this.q = {
      get: this.db.prepare('SELECT * FROM cadets WHERE device_id = ?'),
      insert: this.db.prepare(
        'INSERT INTO cadets (device_id, name, directorate, updated_at) VALUES (?, ?, ?, ?)'),
      identity: this.db.prepare(
        'UPDATE cadets SET name = ?, directorate = ?, updated_at = ? WHERE device_id = ?'),
      look: this.db.prepare(
        'UPDATE cadets SET uniform = ?, beret = ?, badge = ?, updated_at = ? WHERE device_id = ?'),
      race: this.db.prepare(`
        UPDATE cadets SET dp = dp + ?, races = races + 1, wins = wins + ?,
          best_ms = CASE WHEN ? IS NULL THEN best_ms
                         WHEN best_ms IS NULL OR ? < best_ms THEN ? ELSE best_ms END,
          updated_at = ?
        WHERE device_id = ?`),
      byDirectorate: this.db.prepare(`
        SELECT directorate, SUM(dp) AS dp, COUNT(*) AS cadets
        FROM cadets GROUP BY directorate ORDER BY dp DESC`),
      top: this.db.prepare(
        'SELECT name, directorate, dp, wins, best_ms FROM cadets ORDER BY dp DESC LIMIT ?'),
      topIn: this.db.prepare(
        'SELECT name, directorate, dp, wins, best_ms FROM cadets WHERE directorate = ? ORDER BY dp DESC LIMIT ?'),
    };
  }

  // Creates the cadet on first sight; later calls refresh name/directorate.
  upsert(deviceId, name, directorate) {
    const now = Date.now();
    if (this.q.get.get(deviceId)) this.q.identity.run(name, directorate, now, deviceId);
    else this.q.insert.run(deviceId, name, directorate, now);
    this.onChange?.(deviceId);
    return this.profile(deviceId);
  }

  profile(deviceId) {
    const row = this.q.get.get(deviceId);
    if (!row) return null;
    const rankIdx = rankIndexFor(row.dp);
    const next = RANKS[rankIdx + 1];
    return {
      name: row.name,
      directorate: row.directorate,
      dp: row.dp,
      races: row.races,
      wins: row.wins,
      bestMs: row.best_ms,
      rank: RANKS[rankIdx].name,
      rankIndex: rankIdx,
      nextRankDp: next ? next.dp : null,
      uniform: row.uniform,
      beret: row.beret,
      badge: row.badge,
    };
  }

  // Applies a look only if every part is unlocked at the cadet's rank.
  setLook(deviceId, { uniform, beret, badge }) {
    const p = this.profile(deviceId);
    if (!p) return { ok: false, error: 'Unknown cadet' };
    const parts = { uniform, beret, badge };
    for (const [kind, value] of Object.entries(parts)) {
      const need = UNLOCKS[kind][value];
      if (need === undefined) return { ok: false, error: `Unknown ${kind}` };
      if (need > p.rankIndex) return { ok: false, error: `${value} ${kind} unlocks at ${RANKS[need].name}` };
    }
    this.q.look.run(uniform, beret, badge, Date.now(), deviceId);
    this.onChange?.(deviceId);
    return { ok: true, profile: this.profile(deviceId) };
  }

  recordRace(deviceId, { dp, won, timeMs }) {
    const t = timeMs ?? null;
    this.q.race.run(dp, won ? 1 : 0, t, t, t, Date.now(), deviceId);
    this.onChange?.(deviceId);
    return this.profile(deviceId);
  }

  leaderboard(directorate = null, limit = 20) {
    const totals = new Map(this.q.byDirectorate.all().map((r) => [r.directorate, r]));
    const directorates = DIRECTORATES
      .map((name) => ({ name, dp: totals.get(name)?.dp ?? 0, cadets: totals.get(name)?.cadets ?? 0 }))
      .sort((a, b) => b.dp - a.dp);
    const rows = directorate ? this.q.topIn.all(directorate, limit) : this.q.top.all(limit);
    const top = rows.map((r) => ({
      name: r.name, directorate: r.directorate, dp: r.dp, wins: r.wins,
      bestMs: r.best_ms, rank: RANKS[rankIndexFor(r.dp)].name,
    }));
    return { directorates, top, directorate };
  }

  /** The stored row exactly as saved (for copying to another database). */
  rawRow(deviceId) {
    return this.q.get.get(deviceId) ?? null;
  }

  /** Bulk-loads cadet rows (from PgMirror) without triggering onChange. */
  importRows(rows) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO cadets (device_id, name, directorate, dp, races, wins, best_ms, uniform, beret, badge, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.db.exec('BEGIN');
    try {
      for (const r of rows) {
        insert.run(r.device_id, r.name, r.directorate, r.dp, r.races, r.wins, r.best_ms ?? null,
          r.uniform, r.beret, r.badge, r.updated_at);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() { this.db.close(); }
}
