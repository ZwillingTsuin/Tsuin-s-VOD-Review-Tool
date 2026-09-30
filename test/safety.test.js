// What keeps the app safe to run on someone else's PC.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRecording, timeFromName } from '../src/lib/recordings.js';
import { parseRiotId } from '../src/lib/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-test-'));
const PORT = 3800 + Math.floor(Math.random() * 150);
let server;

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'src', 'server.js'), '--no-open', `--port=${PORT}`, `--data=${tmp}`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/status`, { headers: { Host: `localhost:${PORT}` } }); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(async () => {
  const gone = new Promise((r) => server.once('exit', r));
  server.kill();
  await gone;
  // Windows can hold the database file a moment longer
  for (let i = 0; i < 10; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});

const url = (p) => `http://127.0.0.1:${PORT}${p}`;

test('answers on localhost', async () => {
  const r = await fetch(url('/api/status'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.setup.henrik, false);
});

test('identifies itself, so a second start finds it instead of another program', async () => {
  const j = await (await fetch(url('/api/status'))).json();
  assert.equal(j.app, 'vod-review-tool');
  assert.match(j.instance, /^[0-9a-f]{16}$/);
});

test('reads no folder on the PC before the user picks a recordings folder', async () => {
  const s = await (await fetch(url('/api/settings'))).json();
  assert.equal(s.recordingsDir, '');
  const r = await (await fetch(url('/api/recordings'))).json();
  assert.deepEqual([r.exists, r.root, r.files.length], [false, null, 0]);
  const bad = await fetch(url('/api/settings'), { method: 'PATCH', headers: { 'X-VRT': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ recordingsDir: 'relative\videos' }) });
  assert.equal(bad.status, 400);
});

test('the match page counts the notes of its review', async () => {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/match.json', import.meta.url), 'utf8'));
  const id = raw.metadata.match_id, puuid = raw.players[0].puuid;
  fs.mkdirSync(path.join(tmp, 'cache', 'matches'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'cache', 'matches', `${id}.json`), JSON.stringify(raw));
  const post = async (p, body) => (await fetch(url(p), { method: 'POST', headers: { 'X-VRT': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const review = await post('/api/reviews', { match_id: id, puuid });
  for (const n of [1, 2]) await post('/api/notes', { review_id: review.id, round: n, category: 'Positioning', body: `note ${n}` });
  const m = await (await fetch(url(`/api/matches/${id}?puuid=${puuid}`))).json();
  assert.equal(m.review.notes, 2);
});

test('refuses requests addressed to another host (DNS rebinding)', async () => {
  const http = await import('node:http');
  const status = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/status', headers: { Host: 'evil.example.com' } }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(status, 403);
});

test('refuses changes without the app header or from another origin', async () => {
  assert.equal((await fetch(url('/api/prefs'), { method: 'PATCH', body: '{}' })).status, 403);
  assert.equal((await fetch(url('/api/prefs'), { method: 'PATCH', body: '{}', headers: { 'X-VRT': '1', Origin: 'https://evil.example.com' } })).status, 403);
  assert.equal((await fetch(url('/api/prefs'), { method: 'PATCH', body: '{"a":1}', headers: { 'X-VRT': '1', 'Content-Type': 'application/json' } })).status, 200);
});

test('never sends the keys back', async () => {
  await fetch(url('/api/settings'), { method: 'PATCH', headers: { 'X-VRT': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ henrikKey: 'HDEV-12345678-aaaa-bbbb-cccc-1234567890ab' }) });
  const s = await (await fetch(url('/api/settings'))).json();
  assert.ok(!JSON.stringify(s).includes('12345678-aaaa'));
  assert.match(s.henrikKey, /^HDEV…90ab$/);
});

test('static files stay inside the app', async () => {
  const r = await fetch(url('/..%2f..%2fpackage.json'));
  assert.notEqual((await r.text()).includes('"vod-review-tool"'), true);
});

test('recordings: only videos inside the folder', () => {
  fs.mkdirSync(path.join(tmp, 'rec', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'rec', 'sub', 'a.mp4'), 'x');
  fs.writeFileSync(path.join(tmp, 'rec', 'notes.txt'), 'x');
  const dir = path.join(tmp, 'rec');
  assert.ok(resolveRecording(dir, 'sub/a.mp4'));
  assert.equal(resolveRecording(dir, 'notes.txt'), null);
  assert.equal(resolveRecording(dir, '../app.db'), null);
  assert.equal(resolveRecording(dir, path.join(tmp, 'rec', 'sub', 'a.mp4').replace('rec', 'rec2')), null);
  assert.equal(resolveRecording(dir, '..\\..\\Windows\\win.ini'), null);
});

test('recording start times from file names', () => {
  assert.equal(new Date(timeFromName('2026-09-28 20-20-00.mp4')).getHours(), 20);
  assert.ok(timeFromName('VALORANT 2026.09.28 - 20.20.00.02.DVR.mp4'));
  assert.equal(timeFromName('clip.mp4'), null);
});

test('Riot IDs', () => {
  assert.deepEqual(parseRiotId(' Player One # EUW '), { name: 'Player One', tag: 'EUW', full: 'Player One#EUW' });
  assert.equal(parseRiotId('no tag'), null);
  assert.equal(parseRiotId('waytoolongname_12345#tag'), null);
});

test('notes keep formatting but nothing that could run', async () => {
  const { sanitizeHtml, plainText } = await import('../src/lib/richtext.js');
  const dirty = '<p onclick="x()">Hi <b>there</b></p><script>alert(1)</script><img src="x" onerror="alert(1)"><img src="/api/images/0123456789abcdef01234567.png">'
    + '<a href="javascript:alert(1)">bad</a><a href="https://example.com">ok</a><iframe src="https://evil"></iframe><style>*{}</style>';
  const clean = sanitizeHtml(dirty);
  assert.ok(!/script|onerror|onclick|javascript:|iframe|style/i.test(clean), clean);
  assert.ok(clean.includes('<b>there</b>'));
  assert.ok(clean.includes('src="/api/images/0123456789abcdef01234567.png"'));
  assert.ok(!clean.includes('src="x"'));
  assert.ok(clean.includes('href="https://example.com"'));
  assert.equal(plainText('<p>One</p><ul><li>two</li></ul>'), 'One\ntwo');
});

test('screenshots: only real pictures are stored, and served back', async () => {
  // a 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(url('/api/images'), { method: 'POST', headers: { 'X-VRT': '1', 'Content-Type': 'image/png' }, body: png });
  assert.equal(up.status, 200);
  const { url: src } = await up.json();
  assert.match(src, /^\/api\/images\/[a-f0-9]{24}\.png$/);
  const back = await fetch(url(src));
  assert.equal(back.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await back.arrayBuffer()).length, png.length);
  const fake = await fetch(url('/api/images'), { method: 'POST', headers: { 'X-VRT': '1', 'Content-Type': 'image/png' }, body: '<svg onload="alert(1)"></svg>' });
  assert.equal(fake.status, 400);
  assert.equal((await fetch(url('/api/images/..%2f..%2fapp.db'))).status, 404);
});
