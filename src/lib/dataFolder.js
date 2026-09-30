// Moving the data folder: copy, check the copy, switch, then remove only the app's own files from the old folder.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { APP_DIR, HOME_DIR, POINTER_FILE, DATA_PINNED, DATA_DIR, DB_FILE, setDataDir, ensureDirs, writeFileAtomic } from './paths.js';

const OWN = ['app.db', 'app.db-wal', 'app.db-shm', 'cache', 'images', 'backups', 'app.log', 'app.log.old'];
const SYNCED = /[\\/](onedrive|dropbox|google ?drive|icloud ?drive|mega|pcloud)[^\\/]*([\\/]|$)/i;
const same = (a, b) => path.relative(a, b) === '';
const inside = (parent, child) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

function sizeOf(dir) {
  let bytes = 0, files = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) { try { bytes += fs.statSync(f).size; files++; } catch {} }
    }
  };
  for (const name of OWN) {
    const f = path.join(dir, name);
    try { const st = fs.statSync(f); if (st.isDirectory()) walk(f); else { bytes += st.size; files++; } } catch {}
  }
  return { bytes, files };
}

export function info() {
  let matches = 0;
  try { matches = fs.readdirSync(path.join(DATA_DIR, 'cache', 'matches')).filter((f) => /\.json(\.gz)?$/.test(f)).length; } catch {}
  return { dir: DATA_DIR, defaultDir: HOME_DIR, isDefault: same(DATA_DIR, HOME_DIR), pinned: DATA_PINNED, pointerFile: POINTER_FILE, size: sizeOf(DATA_DIR).bytes, matches };
}

// where the data would go for a typed folder, and whether that works
export function check(input) {
  const raw = String(input || '').trim().replace(/^"(.*)"$/, '$1');
  if (DATA_PINNED) return { error: 'The data folder is set by the start command (--data), so it can\'t be changed here.' };
  if (!raw) return { error: 'Type the folder, e.g. D:\\VOD Review Tool' };
  if (!path.isAbsolute(raw)) return { error: 'Use a full path, e.g. D:\\VOD Review Tool' };
  if (/^\\\\/.test(raw)) return { error: 'A network folder doesn\'t work for the database. Pick a folder on this PC.' };
  let dir = path.resolve(raw);
  let state = 'new';
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return { error: 'That is a file, not a folder.' };
    const entries = fs.readdirSync(dir).filter((f) => !/^(data-folder\.json|desktop\.ini|thumbs\.db|\.ds_store)$/i.test(f));
    if (entries.includes('app.db')) state = 'existing';
    else if (entries.length && !same(dir, HOME_DIR)) {
      // a folder with other things in it gets a subfolder
      dir = path.join(dir, 'VOD Review Tool');
      if (fs.existsSync(path.join(dir, 'app.db'))) state = 'existing';
      else if (fs.existsSync(dir) && fs.readdirSync(dir).length) return { error: `${dir} already has other files in it. Pick an empty folder.` };
    } else state = 'empty';
  } catch (err) { if (err.code !== 'ENOENT') return { error: `That folder can't be used (${err.code || err.message}).` }; }

  if (same(dir, DATA_DIR)) return { error: 'Your data is already there.' };
  if (inside(DATA_DIR, dir) || inside(dir, DATA_DIR)) return { error: 'Pick a folder outside the current data folder (and not one that contains it).' };
  if (same(dir, APP_DIR) || inside(APP_DIR, dir)) return { error: 'Not inside the app folder: an update would replace it. Pick a folder of its own.' };
  if (!fs.existsSync(path.parse(dir).root)) return { error: `The drive ${path.parse(dir).root} doesn't exist.` };

  const warnings = [];
  if (SYNCED.test(dir + path.sep)) warnings.push('This folder looks synced by a cloud service (OneDrive, Dropbox …). A sync running while the app writes can damage the database. A folder outside it is safer.');
  if (state !== 'existing') {
    const need = sizeOf(DATA_DIR).bytes;
    try {
      let probe = dir;
      while (!fs.existsSync(probe)) probe = path.dirname(probe);
      const fsInfo = fs.statfsSync(probe);
      if (fsInfo.bavail * fsInfo.bsize < need * 1.1 + 50e6) return { error: `Not enough free space there (${Math.round(need / 1e6)} MB needed).` };
    } catch {}
  }
  return { ok: true, dir, state, isDefault: same(dir, HOME_DIR), warnings };
}

function writable(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `.write-test-${process.pid}`);
  fs.writeFileSync(f, 'ok');
  fs.unlinkSync(f);
}

// Synchronous on purpose: nothing else runs between the copy and the switch, so nothing lands in the old folder late.
export function move(input, db, { onMoved } = {}) {
  const c = check(input);
  if (!c.ok) return c;
  const from = DATA_DIR, to = c.dir, fresh = !fs.existsSync(to);
  try { writable(to); } catch (err) { return { error: `Can't write to that folder (${err.code || err.message}).` }; }

  if (c.state !== 'existing') {
    try {
      db.exec(`VACUUM INTO '${path.join(to, 'app.db').replace(/'/g, "''")}'`);
      for (const sub of ['cache', 'images', 'backups']) {
        if (fs.existsSync(path.join(from, sub))) fs.cpSync(path.join(from, sub), path.join(to, sub), { recursive: true });
      }
      const test = new DatabaseSync(path.join(to, 'app.db'), { readOnly: true });
      const ok = test.prepare('PRAGMA quick_check').get();
      test.close();
      if (Object.values(ok)[0] !== 'ok') throw new Error('the copied database did not pass its check');
    } catch (err) {
      for (const name of OWN) { try { fs.rmSync(path.join(to, name), { recursive: true, force: true }); } catch {} }
      if (fresh) { try { fs.rmdirSync(to); } catch {} }
      return { error: `Moving failed, nothing was changed (${err.message}).` };
    }
  }

  if (same(to, HOME_DIR)) { try { fs.unlinkSync(POINTER_FILE); } catch {} }
  else { fs.mkdirSync(HOME_DIR, { recursive: true }); writeFileAtomic(POINTER_FILE, JSON.stringify({ dataDir: to }, null, 2)); }
  setDataDir(to);
  ensureDirs();
  db.swap(DB_FILE);
  if (onMoved) onMoved(to);

  let leftBehind = null;
  if (c.state === 'existing') leftBehind = from;
  else {
    for (const name of OWN) { try { fs.rmSync(path.join(from, name), { recursive: true, force: true }); } catch {} }
    if (!same(from, HOME_DIR)) { try { fs.rmdirSync(from); } catch {} }
  }
  return { ok: true, dir: to, used: c.state === 'existing', leftBehind };
}

export function reveal() {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [DATA_DIR]] : process.platform === 'darwin' ? ['open', [DATA_DIR]] : ['xdg-open', [DATA_DIR]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch {}
  return { ok: true };
}
