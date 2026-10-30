// NCC Cadet Challenge server: one process handles lobby, matchmaking and race sync
// over plain WebSockets (JSON messages). See ../README.md for the protocol.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { Lobby } from './lobby.js';
import { PgMirror } from './pg-mirror.js';

const PORT = Number(process.env.PORT ?? 2567);
// DATABASE_URL (e.g. Supabase) = cadets are saved there, for hosts that wipe their disk
// on restart (Render free). Without it, everything is saved in the local SQLite file.
const DATABASE_URL = process.env.DATABASE_URL?.trim() || null;
const DB_FILE = DATABASE_URL ? ':memory:' : (process.env.DB_FILE ?? 'data/ncc.db');
const MAX_MSGS_PER_SEC = 30;

if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const store = new Store(DB_FILE);
let mirror = null;
if (DATABASE_URL) {
  // Retry while the database wakes up. If it never answers, run without saving rather than
  // risk overwriting saved cadets with fresh empty profiles.
  for (let attempt = 1; attempt <= 5 && !mirror; attempt++) {
    const m = new PgMirror(DATABASE_URL, { ssl: process.env.DATABASE_SSL !== 'disable' });
    try {
      const count = await m.load(store);
      mirror = m;
      console.log(`Postgres connected: loaded ${count} cadets`);
    } catch (err) {
      console.error(`Postgres unavailable (attempt ${attempt}/5): ${err.message}`);
      await m.pool.end().catch(() => {});
      if (attempt < 5) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  if (!mirror) console.error('Database unavailable: progress will NOT be saved until the server restarts with a working DATABASE_URL.');
}
const lobby = new Lobby(store);

// The browser version of the game (Godot web export) is served from WEB_DIR, so one
// free server hosts both the website and the multiplayer WebSocket (same origin).
const WEB_DIR = path.resolve(process.env.WEB_DIR ?? '../docs');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(WEB_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(WEB_DIR + path.sep) && file !== WEB_DIR) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  // Browsers must re-check every file on each visit (no-cache) so players always get
  // the latest game after an update; unchanged files cost only a quick 304.
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' });
    res.end();
    return true;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
    etag,
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    const database = mirror ? 'postgres' : DATABASE_URL ? 'unavailable' : 'sqlite';
    return res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size, sessions: lobby.sessions.size, database }));
  }
  if (req.method === 'GET' && serveStatic(req, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('NCC Cadet Challenge server. Web game not built here (see README).\n');
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  const send = (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  let session = lobby.connect(send);
  let windowStart = Date.now();
  let count = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > MAX_MSGS_PER_SEC) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try {
      const result = lobby.handle(session, msg);
      if (msg?.t === 'hello' && result && result !== session) session = result; // resumed
    } catch (err) {
      console.error('handler error', msg?.t, err);
    }
  });

  ws.on('close', () => lobby.disconnect(session, send));
});

// Detect dead sockets (phones that lost network without closing).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

setInterval(() => lobby.tick(), 100);
setInterval(() => lobby.sweep(), 5000);
setInterval(() => lobby.broadcastStats(), 2000);

server.listen(PORT, () => console.log(`NCC Cadet Challenge server on :${PORT} (db: ${mirror ? 'postgres' : DB_FILE})`));

// Render stops the old server on every deploy: save pending changes first.
const shutdown = async () => {
  server.close();
  await mirror?.close().catch((err) => console.error('Final save failed', err.message));
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
