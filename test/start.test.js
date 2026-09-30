// Start.bat → launch.js: it reports whether the app started, was already running, or why it couldn't start.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setDataDir } from '../src/lib/paths.js';
import { createStore } from '../src/lib/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-start-'));
const PORT = 3990 + Math.floor(Math.random() * 9);
const launch = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(root, 'src', 'launch.js'), '--no-open', ...args], { timeout: 40000 }, (err, stdout) => resolve({ code: err ? err.code : 0, out: stdout }));
});

after(async () => {
  await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST', headers: { 'X-VRT': '1' } }).catch(() => {});
  for (let i = 0; i < 15; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});

test('starts the app in the background, and a second start finds it', async () => {
  const first = await launch(`--port=${PORT}`, `--data=${path.join(tmp, 'data')}`);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, new RegExp(`Running at http://localhost:${PORT}`));
  assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/status`)).json()).background, true);
  const second = await launch(`--port=${PORT}`, `--data=${path.join(tmp, 'data')}`);
  assert.equal(second.code, 0);
  assert.match(second.out, /already running/);
});

test('says why it could not start', async () => {
  const r = await launch('--port=3989', '--data=Q:\\nope\\vrt');
  assert.equal(r.code, 1);
  assert.match(r.out, /data folder .* can't be used/);
});

test('reads plain match files of older versions and compresses them', () => {
  setDataDir(path.join(tmp, 'cache-test'));
  const dir = path.join(tmp, 'cache-test', 'cache', 'matches');
  fs.mkdirSync(dir, { recursive: true });
  const id = '0123abcd-0123-4567-89ab-0123456789ab';
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ metadata: { match_id: id }, rounds: [] }));
  const store = createStore({}, {});
  assert.equal(store.cachedMatch(id).metadata.match_id, id);
  assert.ok(!fs.existsSync(path.join(dir, `${id}.json`)));
  assert.equal(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, `${id}.json.gz`)))).metadata.match_id, id);
  assert.ok(store.hasMatch(id));
});
