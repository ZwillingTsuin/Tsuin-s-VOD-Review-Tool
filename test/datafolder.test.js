// Moving the data folder: nothing is lost, only the app's own files leave the old folder, and the app finds it again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-folder-'));
const home = path.join(tmp, 'home');
const PORT = 3950 + Math.floor(Math.random() * 40);
let server;

async function start() {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'src', 'server.js'), '--no-open', `--port=${PORT}`, `--home=${home}`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/status`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
}
async function stop() {
  const gone = new Promise((r) => server.once('exit', r));
  server.kill();
  await gone;
}
before(start);
after(async () => {
  await stop();
  for (let i = 0; i < 10; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});

const url = (p) => `http://127.0.0.1:${PORT}${p}`;
const post = async (p, body) => (await fetch(url(p), { method: 'POST', headers: { 'X-VRT': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const get = async (p) => (await fetch(url(p))).json();

test('refuses folders that would break or lose data', async () => {
  for (const dir of ['relative\\folder', path.join(root, 'data'), path.join(home, 'cache'), '\\\\server\\share\\vrt']) {
    const c = await post('/api/data-folder/check', { dir });
    assert.ok(c.error, `${dir} should be refused`);
  }
  const synced = await post('/api/data-folder/check', { dir: path.join(tmp, 'OneDrive', 'VRT') });
  assert.equal(synced.ok, true);
  assert.equal(synced.warnings.length, 1);
});

test('a folder with other files in it gets a subfolder', async () => {
  const busy = path.join(tmp, 'busy');
  fs.mkdirSync(busy);
  fs.writeFileSync(path.join(busy, 'something.txt'), 'x');
  const c = await post('/api/data-folder/check', { dir: busy });
  assert.equal(c.dir, path.join(busy, 'VOD Review Tool'));
});

test('moves everything, keeps it working, and finds it again after a restart', async () => {
  await fetch(url('/api/prefs'), { method: 'PATCH', headers: { 'X-VRT': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ marker: 'kept' }) });
  fs.writeFileSync(path.join(home, 'someone-elses-file.txt'), 'stays');
  const to = path.join(tmp, 'moved');
  const m = await post('/api/data-folder/move', { dir: to });
  assert.equal(m.ok, true);
  assert.equal((await get('/api/status')).dataDir, to);
  assert.equal((await get('/api/prefs')).marker, 'kept');
  assert.ok(fs.existsSync(path.join(to, 'app.db')));
  assert.deepEqual(fs.readdirSync(home).sort(), ['data-folder.json', 'someone-elses-file.txt']);

  await stop();
  await start();
  assert.equal((await get('/api/status')).dataDir, to);
  assert.equal((await get('/api/prefs')).marker, 'kept');
});

test('moving back to the default folder removes the pointer', async () => {
  const m = await post('/api/data-folder/move', { dir: home });
  assert.equal(m.ok, true, m.error);
  assert.equal(m.info.isDefault, true);
  assert.ok(!fs.existsSync(path.join(home, 'data-folder.json')));
  assert.ok(!fs.existsSync(path.join(tmp, 'moved')));
  assert.equal((await get('/api/prefs')).marker, 'kept');
});
