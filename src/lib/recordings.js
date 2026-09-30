// Recordings for the VOD review: only the folder set in Settings, only video files, only read.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VIDEO = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska' };
const MAX_FILES = 2000;

export const defaultRecordingsDir = () => path.join(os.homedir(), 'Videos');

// OBS / ShadowPlay / Medal put the start time in the name ("2026-09-28 20-20-00.mp4"); unlike file dates it survives
// copying. Local time.
export function timeFromName(name) {
  const m = String(name).match(/(20\d\d)[-._](\d\d)[-._](\d\d)[ _T-]+(\d\d)[-._:](\d\d)[-._:](\d\d)/);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(t) ? t : null;
}

// videos up to 3 levels deep, newest first
export function listRecordings(root) {
  if (!root || !fs.existsSync(root)) return { root, exists: false, files: [] };
  const files = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3 && !e.name.startsWith('.')) walk(full, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!VIDEO[ext]) continue;
      try {
        const st = fs.statSync(full);
        const named = timeFromName(e.name);
        files.push({ rel: path.relative(root, full).split(path.sep).join('/'), name: e.name, size: st.size,
          start: new Date(named || st.birthtimeMs || st.ctimeMs).toISOString(), end: new Date(st.mtimeMs).toISOString(), playable: ext !== '.mkv' });
      } catch {}
    }
  };
  walk(root, 0);
  files.sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
  return { root, exists: true, files };
}

export function resolveRecording(root, rel) {
  if (!root || typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const full = path.resolve(root, rel);
  const base = path.resolve(root) + path.sep;
  if (!full.startsWith(base)) return null;
  if (!VIDEO[path.extname(full).toLowerCase()]) return null;
  try { if (!fs.statSync(full).isFile()) return null; } catch { return null; }
  return full;
}

// range requests: the video player seeks with them
export function streamRecording(req, res, full) {
  const st = fs.statSync(full), type = VIDEO[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
    if (!(start >= 0) || start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}

// recordings running while the match was played (created at the start, last written at the end)
export function recordingsFor(list, startedAt, lengthMs) {
  const s = Date.parse(startedAt), e = s + (lengthMs || 40 * 60000);
  return list.filter((f) => Date.parse(f.start) < e && Date.parse(f.end) > s)
    .map((f) => ({ ...f, offsetGuess: Math.max(0, Math.round((s - Date.parse(f.start)) / 1000)) }));
}
