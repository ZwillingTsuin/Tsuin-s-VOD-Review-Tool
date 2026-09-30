// The app folder is never written to; data lives in the user's profile, or wherever data-folder.json in the default
// folder points after a move. --data=<dir> (or VRT_DATA) pins it for one run; --home=<dir> replaces the default.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PUBLIC_DIR = path.join(APP_DIR, 'public');

function defaultDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'VOD Review Tool');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'VOD Review Tool');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'vod-review-tool');
}
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);

export const HOME_DIR = path.resolve(arg('home') || defaultDataDir());
export const POINTER_FILE = path.join(HOME_DIR, 'data-folder.json');
const pinned = arg('data') || process.env.VRT_DATA || '';
export const DATA_PINNED = !!pinned;

export let DATA_DIR, CACHE_DIR, MATCH_DIR, ANALYSIS_DIR, ASSET_DIR, BACKUP_DIR, IMAGE_DIR, DB_FILE;
export function setDataDir(dir) {
  DATA_DIR = path.resolve(dir);
  CACHE_DIR = path.join(DATA_DIR, 'cache');
  MATCH_DIR = path.join(CACHE_DIR, 'matches');
  ANALYSIS_DIR = path.join(CACHE_DIR, 'analysis');
  ASSET_DIR = path.join(CACHE_DIR, 'assets');
  BACKUP_DIR = path.join(DATA_DIR, 'backups');
  IMAGE_DIR = path.join(DATA_DIR, 'images');
  DB_FILE = path.join(DATA_DIR, 'app.db');
}
const pointed = readJson(POINTER_FILE, {}).dataDir;
setDataDir(pinned || (typeof pointed === 'string' && path.isAbsolute(pointed) ? pointed : HOME_DIR));

export function ensureDirs() {
  for (const d of [DATA_DIR, CACHE_DIR, MATCH_DIR, ANALYSIS_DIR, ASSET_DIR, BACKUP_DIR, IMAGE_DIR]) fs.mkdirSync(d, { recursive: true });
}

export function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export const appVersion = () => readJson(path.join(APP_DIR, 'package.json'), {}).version || '0.0.0';
