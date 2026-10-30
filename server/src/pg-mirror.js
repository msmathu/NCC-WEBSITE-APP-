// Keeps cadet profiles in a hosted Postgres database (e.g. Supabase) for free hosts whose
// disk is wiped on every restart (Render). The game keeps using the fast in-memory SQLite
// Store; this loads every cadet into it at startup and writes changed cadets back in the
// background, so lobby code stays synchronous.
import pg from 'pg';

const COLUMNS = ['device_id', 'name', 'directorate', 'dp', 'races', 'wins', 'best_ms',
  'uniform', 'beret', 'badge', 'updated_at'];
const FLUSH_MS = 2000;

/** Removes sslmode from the URL so the explicit ssl option below is used. */
function withoutSslMode(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}

export class PgMirror {
  constructor(url, { ssl = true, log = console } = {}) {
    this.pool = new pg.Pool({
      connectionString: withoutSslMode(url),
      // Supabase's pooler certificate is not in Node's default CA list; traffic is still encrypted.
      ssl: ssl ? { rejectUnauthorized: false } : false,
      max: 3,
      connectionTimeoutMillis: 10_000,
    });
    this.pool.on('error', (err) => log.error('Postgres pool error', err.message));
    this.log = log;
    this.dirty = new Set();
    this.timer = null;
    this.flushing = null;
  }

  /** Creates the table if needed and copies every cadet into the in-memory store. */
  async load(store) {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ncc_cadets (
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
        updated_at  BIGINT NOT NULL
      )`);
    const { rows } = await this.pool.query(`SELECT ${COLUMNS.join(', ')} FROM ncc_cadets`);
    store.importRows(rows.map((r) => ({ ...r, updated_at: Number(r.updated_at) })));
    store.onChange = (deviceId) => this.markDirty(deviceId);
    this.store = store;
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    return rows.length;
  }

  markDirty(deviceId) {
    this.dirty.add(deviceId);
  }

  /** Writes every changed cadet; failed ones stay queued for the next try. */
  async flush() {
    if (this.flushing) return this.flushing;
    if (this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    this.flushing = (async () => {
      for (const id of ids) {
        const row = this.store.rawRow(id);
        if (!row) continue;
        try {
          await this.pool.query(
            `INSERT INTO ncc_cadets (${COLUMNS.join(', ')})
             VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
             ON CONFLICT (device_id) DO UPDATE SET
               ${COLUMNS.slice(1).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
            COLUMNS.map((c) => row[c] ?? null));
        } catch (err) {
          this.dirty.add(id);
          this.log.error('Could not save cadet to Postgres', err.message);
        }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
    await this.pool.end();
  }
}
