// Local server: listens on 127.0.0.1 only, answers only requests addressed to localhost, writes need the X-VRT header.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ensureDirs, PUBLIC_DIR, DATA_DIR, HOME_DIR, POINTER_FILE, DATA_PINNED, appVersion } from './lib/paths.js';
import { openDb, getKv } from './lib/db.js';
import { createHenrik } from './lib/henrik.js';
import { createStore } from './lib/store.js';
import { createInsights } from './lib/insights.js';
import { createTwitch } from './lib/twitch.js';
import { createVod } from './lib/vod.js';
import { router, sendJson, HttpError } from './lib/http.js';
import { coreRoutes } from './routes/core.js';
import { reviewRoutes } from './routes/reviews.js';

const argv = process.argv.slice(2);
const PORT_ARG = Number((argv.find((a) => a.startsWith('--port=')) || '').slice(7)) || Number(process.env.PORT) || 0;
const FIRST_PORT = PORT_ARG || 3710;
const LAST_PORT = PORT_ARG || 3719;
const HOST = '127.0.0.1';
const OPEN = !argv.includes('--no-open') && process.env.VRT_NO_OPEN !== '1';
const BACKGROUND = argv.includes('--background');
const IDLE_STOP_MS = 45 * 60000;
// tells this user's app apart from other programs or other copies of the app on the same port
const INSTANCE = crypto.createHash('sha256').update(DATA_PINNED ? DATA_DIR : HOME_DIR).digest('hex').slice(0, 16);

// launch.js waits for one message: started, already running, or why not
let reported = false;
function report(msg) {
  if (reported || !process.send) return;
  reported = true;
  try { process.send(msg, () => { try { process.disconnect(); } catch {} }); } catch {}
}
function fail(message) {
  console.error(message);
  report({ error: message, log: BACKGROUND && logStream ? logFile() : null });
  setTimeout(() => process.exit(1), 200);
}

// --background has no window: output goes to app.log in the data folder
const logFile = () => path.join(DATA_DIR, 'app.log');
let logStream = null;
function openLog() {
  const file = logFile();
  try { if (fs.statSync(file).size > 2e6) fs.renameSync(file, file + '.old'); } catch {}
  const next = fs.createWriteStream(file, { flags: 'a' });
  if (logStream) logStream.end();
  logStream = next;
}
if (BACKGROUND) {
  const line = (level) => (...a) => logStream && logStream.write(`${new Date().toISOString()} ${level} ${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
  console.log = line('info'); console.warn = line('warn'); console.error = line('error');
  process.on('uncaughtException', (err) => console.error(err));
}
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const full = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return false;
  let st;
  try { st = fs.statSync(full); } catch { return false; }
  if (!st.isFile()) return false;
  // no-cache + ETag: an update shows on the next load, unchanged files answer 304
  const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); res.end(); return true; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', ETag: etag });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(full).pipe(res);
  return true;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://player.twitch.tv https://embed.twitch.tv https://www.youtube.com https://s.ytimg.com",
  "frame-src https://player.twitch.tv https://embed.twitch.tv https://clips.twitch.tv https://www.youtube.com https://www.youtube-nocookie.com",
  "img-src 'self' data: blob: https://media.valorant-api.com https://static-cdn.jtvnw.net https://i.ytimg.com",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

// this user's app on that port → its version. Versions before 0.6 have no instance id, only their data folder.
async function ourAppOn(port) {
  try {
    const r = await fetch(`http://${HOST}:${port}/api/status`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    const same = j.instance ? j.app === 'vod-review-tool' && j.instance === INSTANCE : !!j.dataDir && path.resolve(j.dataDir) === DATA_DIR;
    return same ? { version: j.version } : null;
  } catch { return null; }
}

// First free port from 3710. Another program's port is skipped, never taken over; this app in another version
// (still running from before an update) is asked to stop and replaced.
async function listen(server) {
  const tryPort = (port) => new Promise((resolve) => {
    const onError = (e) => { server.off('listening', onListening); resolve(e); };
    const onListening = () => { server.off('error', onError); resolve(null); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    let err = await tryPort(port);
    if (!err) return { port };
    // EACCES: Windows reserves some port ranges (Hyper-V, WSL, Docker)
    if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
    const other = await ourAppOn(port);
    if (!other) continue;
    if (other.version === appVersion()) return { port, already: true };
    await fetch(`http://${HOST}:${port}/api/quit`, { method: 'POST', headers: { 'X-VRT': '1' }, signal: AbortSignal.timeout(3000) }).catch(() => {});
    for (let i = 0; i < 30 && err; i++) { await new Promise((r) => setTimeout(r, 200)); err = await tryPort(port); }
    if (!err) { console.log(`Replaced version ${other.version} that was still running.`); return { port }; }
  }
  return { port: null };
}

async function main() {
  try { ensureDirs(); } catch (err) {
    return fail(`The data folder ${DATA_DIR} can't be used (${err.code || err.message}).`
      + (fs.existsSync(POINTER_FILE) ? ` If it was on a drive that is gone, delete ${POINTER_FILE} to go back to the default folder.` : ''));
  }
  if (BACKGROUND) openLog();
  let db;
  try { db = openDb(); } catch (err) { return fail(`The database in ${DATA_DIR} can't be opened: ${err.message}`); }

  const henrik = createHenrik(() => getKv(db, 'henrik_key'));
  const store = createStore(db, henrik);
  const insights = createInsights({
    cachedMatch: store.cachedMatch, myRecords: store.myRecords, proRecords: store.proRecords,
    pros: () => store.pros(), backfill: store.backfillStatus,
  });
  const twitch = createTwitch(() => ({ clientId: getKv(db, 'twitch_client_id'), clientSecret: getKv(db, 'twitch_client_secret') }));
  const vod = createVod(db, { store, insights, twitch });
  store.onDownloaded((id) => { insights.analysed(id).catch(() => {}); });
  // check Twitch soon after new matches instead of waiting for the 2-hour round
  store.onBackfillDone(() => vod.soon(15000));
  store.onNewMatches(() => vod.soon(90000));

  const stop = () => { try { db.close(); } catch {} process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const api = router();
  coreRoutes(api, { db, henrik, store, insights, twitch, vod, instance: INSTANCE, background: BACKGROUND, idleStopMin: IDLE_STOP_MS / 60000, onDataMoved: () => { if (BACKGROUND) openLog(); } });
  reviewRoutes(api, { db, store, vod });
  api.post('/api/quit', (req, res) => { sendJson(res, 200, { ok: true }); setTimeout(stop, 200); });

  let allowedHosts = new Set();
  let lastSeen = Date.now();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    try {
      // DNS rebinding: a website can point its own domain at 127.0.0.1
      if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) { res.writeHead(403); res.end('Forbidden'); return; }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        lastSeen = Date.now();
        const write = !['GET', 'HEAD'].includes(req.method);
        const origin = req.headers.origin;
        if (write && (req.headers['x-vrt'] !== '1' || (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, '').toLowerCase())))) {
          sendJson(res, 403, { error: 'forbidden' }); return;
        }
        if (!(await api.handle(req, res, url))) sendJson(res, 404, { error: 'Not found' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      if (!serveStatic(req, res, url.pathname)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Something went wrong' });
      else res.end();
    }
  });

  let got;
  try { got = await listen(server); } catch (err) { return fail(`The app could not start its server: ${err.message}`); }
  if (!got.port) return fail(`Ports ${FIRST_PORT} to ${LAST_PORT} are all used by other programs. Start it with another port, e.g. "Start.bat --port=3790".`);
  const url = `http://localhost:${got.port}`;
  if (got.already) {
    console.log(`The app is already running (${url}).`);
    if (OPEN) openBrowser(url);
    report({ already: true, url, opened: OPEN });
    try { db.close(); } catch {}
    setTimeout(() => process.exit(0), 300);
    return;
  }
  allowedHosts = new Set([`localhost:${got.port}`, `127.0.0.1:${got.port}`, `[::1]:${got.port}`]);
  console.log(`VOD Review Tool ${appVersion()} is running: ${url}`);
  console.log(`Your data: ${DATA_DIR}`);
  console.log(BACKGROUND ? 'Running without a window: stop it with the power button in the app.' : 'Close this window (or press Ctrl+C) to stop it.');
  store.start();
  vod.start();
  if (OPEN) openBrowser(url);
  report({ ok: true, url, opened: OPEN });

  if (BACKGROUND) {
    let lastTick = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - lastTick > 5 * 60000) lastSeen = now;   // the PC was asleep: the open tabs haven't had a chance to check in
      lastTick = now;
      const q = henrik.status().queue;
      const busy = store.backfillStatus().running || store.proSyncStatus().running || vod.status().running || q.user + q.sync + q.background > 0;
      if (!busy && now - lastSeen > IDLE_STOP_MS) { console.log('No page open for a while and nothing to download: stopping.'); stop(); }
    }, 60000).unref();
  }
}

main();
