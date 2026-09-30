import { getKv, setKv } from '../lib/db.js';
import { bad, notFound } from '../lib/http.js';
import { DATA_DIR, ASSET_DIR, appVersion, writeFileAtomic } from '../lib/paths.js';
import * as dataFolder from '../lib/dataFolder.js';
import fs from 'node:fs';
import path from 'node:path';
import * as assets from '../lib/assets.js';
import { shapeMatch } from '../lib/matchAnalysis.js';
import { quickAnalysis } from '../lib/quickAnalysis.js';
import { defaultRecordingsDir } from '../lib/recordings.js';

export const DEFAULT_CATEGORIES = ['Positioning', 'Crosshair & aim', 'Utility', 'Timing', 'Decisions', 'Teamplay', 'Economy'];
const isId = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));
const mask = (s) => (s ? `${String(s).slice(0, 4)}…${String(s).slice(-4)}` : null);
const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

export function coreRoutes(r, { db, henrik, store, insights, twitch, vod, instance, background, idleStopMin, onDataMoved }) {
  const running = appVersion();
  r.get('/api/status', () => ({
    app: 'vod-review-tool', instance, version: running, updated: appVersion() !== running ? appVersion() : null,
    background, idleStopMin, dataDir: DATA_DIR,
    setup: { henrik: !!getKv(db, 'henrik_key'), accounts: store.accounts().length, twitch: twitch.enabled(), done: !!getKv(db, 'setup_done') },
    henrik: henrik.status(), backfill: store.backfillStatus(), pros: store.proSyncStatus(), vod: vod.status(),
  }));

  r.get('/api/settings', () => ({
    henrikKey: mask(getKv(db, 'henrik_key')), twitchClientId: mask(getKv(db, 'twitch_client_id')), twitchSecret: mask(getKv(db, 'twitch_client_secret')),
    myTwitch: getKv(db, 'my_twitch'), myVodDelay: getKv(db, 'my_vod_delay'),
    recordingsDir: getKv(db, 'recordings_dir') || '', recordingsSuggestion: defaultRecordingsDir(),
    categories: getKv(db, 'note_categories') || DEFAULT_CATEGORIES,
    dataDir: DATA_DIR, version: appVersion(),
  }));
  r.patch('/api/settings', (req) => {
    const b = req.body;
    if (b.henrikKey !== undefined) {
      const k = clean(b.henrikKey, 200);
      if (k && !/^[A-Za-z0-9-_]{10,}$/.test(k)) throw bad('That does not look like a HenrikDev key (it starts with HDEV-).');
      setKv(db, 'henrik_key', k || null);
      if (k) { store.refreshAll().catch(() => {}).finally(() => store.runBackfill().catch(() => {})); }
    }
    if (b.twitchClientId !== undefined) setKv(db, 'twitch_client_id', clean(b.twitchClientId, 100) || null);
    if (b.twitchSecret !== undefined) setKv(db, 'twitch_client_secret', clean(b.twitchSecret, 100) || null);
    if (b.myTwitch !== undefined) {
      const ch = b.myTwitch ? clean(b.myTwitch, 100).toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '') : null;
      setKv(db, 'my_twitch', ch || null);
      if (ch && twitch.enabled()) vod.runSync().catch(() => {});
    }
    if (b.recordingsDir !== undefined) {
      const dir = clean(b.recordingsDir, 500).replace(/^"(.*)"$/, '$1');
      if (dir && !path.isAbsolute(dir)) throw bad('Use the full path of the folder, e.g. C:\\Users\\you\\Videos');
      setKv(db, 'recordings_dir', dir ? path.resolve(dir) : null);
    }
    if (Array.isArray(b.categories)) {
      const cats = [...new Set(b.categories.map((c) => clean(c, 40)).filter(Boolean))].slice(0, 20);
      setKv(db, 'note_categories', cats.length ? cats : null);
    }
    if (b.setupDone !== undefined) setKv(db, 'setup_done', !!b.setupDone);
    if ((b.twitchClientId !== undefined || b.twitchSecret !== undefined) && twitch.enabled()) vod.runSync().catch(() => {});
    return { ok: true };
  });
  r.post('/api/settings/test-henrik', async (req) => {
    const key = clean(req.body.key, 200) || getKv(db, 'henrik_key');
    if (!key) throw bad('No key to test.');
    return henrik.test(key);
  });
  r.post('/api/settings/test-twitch', async (req) => {
    const clientId = clean(req.body.clientId, 100) || getKv(db, 'twitch_client_id'), clientSecret = clean(req.body.clientSecret, 100) || getKv(db, 'twitch_client_secret');
    if (!clientId || !clientSecret) throw bad('Both the Client ID and the Client Secret are needed.');
    return twitch.test({ clientId, clientSecret });
  });
  r.get('/api/data-folder', () => dataFolder.info());
  r.post('/api/data-folder/check', (req) => dataFolder.check(req.body.dir));
  r.post('/api/data-folder/move', (req) => {
    const out = dataFolder.move(req.body.dir, db, { onMoved: onDataMoved });
    if (out.error) throw bad(out.error);
    return { ...out, info: dataFolder.info() };
  });
  r.post('/api/data-folder/open', () => dataFolder.reveal());
  // view preferences live with the data, not the browser
  r.get('/api/prefs', () => getKv(db, 'prefs', {}));
  r.patch('/api/prefs', (req) => {
    const cur = getKv(db, 'prefs', {});
    for (const [k, v] of Object.entries(req.body || {})) if (/^[a-z0-9_]{1,40}$/i.test(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) cur[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    setKv(db, 'prefs', cur);
    return cur;
  });

  r.get('/api/accounts', () => store.accounts().map(store.publicAccount));
  r.post('/api/accounts', async (req) => { const out = await store.addAccount(req.body.riotId); if (out.error) throw bad(out.error); return out; });
  r.del('/api/accounts/:id', (req, res, p) => store.removeAccount(Number(p.id)));
  r.patch('/api/accounts/:id', (req, res, p) => { if (req.body.inInsights !== undefined) store.setAccountInsights(Number(p.id), !!req.body.inInsights); return { ok: true }; });
  r.post('/api/accounts/:id/refresh', async (req, res, p) => { const out = await store.refreshOne(Number(p.id)); if (out.error) throw bad(out.error); return out; });

  r.get('/api/pros', () => store.pros().map((p) => ({
    id: p.id, name: p.name, twitch: p.twitch, twitchAvatar: p.twitch_avatar || null, vodDelay: p.vod_delay, delayChecked: p.vod_delay != null, matchLimit: p.match_limit,
    accounts: p.accounts.map((a) => ({ riotId: a.riot_id, resolved: !!a.puuid, error: a.error, syncedAt: a.synced_at })),
    matches: db.prepare('SELECT COUNT(DISTINCT match_id) AS n FROM matches WHERE owner = ?').get(p.id).n,
    downloaded: db.prepare('SELECT match_id FROM matches WHERE owner = ? GROUP BY match_id').all(p.id).filter((m) => store.hasMatch(m.match_id)).length,
    plays: db.prepare("SELECT COUNT(*) AS n FROM plays WHERE player = ? AND (expires IS NULL OR expires >= date('now'))").get(p.id).n,
  })));
  r.post('/api/pros', (req) => { const out = store.addPro(req.body); if (out.error) throw bad(out.error); return out; });
  r.patch('/api/pros/:id', (req, res, p) => {
    const out = store.updatePro(p.id, req.body);
    if (out.error) throw bad(out.error);
    if (req.body.twitch && twitch.enabled()) vod.runSync().catch(() => {});
    return out;
  });
  r.del('/api/pros/:id', (req, res, p) => store.removePro(p.id));
  r.get('/api/twitch/search', async (req) => twitch.search(clean(req.query.q, 60)));

  r.get('/api/assets', async () => assets.bundle());
  // only URLs from valorant-api.com's map list, never one from the request
  r.get('/api/minimap/:uuid', async (req, res, p) => {
    if (!/^[0-9a-f-]{36}$/i.test(p.uuid)) throw bad('Bad map id');
    const file = path.join(ASSET_DIR, `minimap-${p.uuid.toLowerCase()}.png`);
    if (!fs.existsSync(file)) {
      const map = (await assets.maps()).find((m) => m.uuid && m.uuid.toLowerCase() === p.uuid.toLowerCase());
      if (!map || !map.minimap || !/^https:\/\/media\.valorant-api\.com\//.test(map.minimap)) throw notFound('Unknown map');
      const r2 = await fetch(map.minimap, { signal: AbortSignal.timeout(20000) });
      if (!r2.ok) throw notFound('The minimap could not be loaded');
      writeFileAtomic(file, Buffer.from(await r2.arrayBuffer()));
    }
    const st = fs.statSync(file);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=604800' });
    fs.createReadStream(file).pipe(res);
  });

  // ?account=<puuid> &limit= &offset= &open=1 (not reviewed yet)
  r.get('/api/matches', (req) => {
    const q = req.query, where = ["m.owner = 'me'", 'm.puuid IN (SELECT puuid FROM accounts)'], args = [];
    if (q.account) { where.push('m.puuid = ?'); args.push(String(q.account)); }
    if (q.open === '1') where.push("NOT EXISTS (SELECT 1 FROM reviews v WHERE v.kind = 'match' AND v.match_id = m.match_id AND v.puuid = m.puuid AND v.status = 'done')");
    const limit = Math.min(200, Number(q.limit) || 60), offset = Math.max(0, Number(q.offset) || 0);
    const sql = `FROM matches m WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
    const rows = db.prepare(`SELECT m.*, rr.rr, a.riot_id,
        (SELECT v.status FROM reviews v WHERE v.kind = 'match' AND v.match_id = m.match_id AND v.puuid = m.puuid) AS review_status,
        (SELECT COUNT(*) FROM notes n JOIN reviews v ON v.id = n.review_id WHERE v.kind = 'match' AND v.match_id = m.match_id AND v.puuid = m.puuid) AS notes,
        (SELECT p.id FROM plays p WHERE p.player = 'me' AND p.kind = 'game' AND p.match_id = m.match_id AND p.puuid = m.puuid AND (p.expires IS NULL OR p.expires >= date('now'))) AS vod_play
      ${sql.replace('FROM matches m', 'FROM matches m LEFT JOIN rr ON rr.match_id = m.match_id AND rr.puuid = m.puuid LEFT JOIN accounts a ON a.puuid = m.puuid')}
      ORDER BY m.date DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { total, matches: rows.map((m) => ({ ...m, downloaded: store.hasMatch(m.match_id) })) };
  });

  r.get('/api/matches/:id', async (req, res, p) => {
    if (!isId(p.id)) throw bad('Bad match id');
    const puuid = String(req.query.puuid || '');
    const rec = db.prepare('SELECT * FROM matches WHERE match_id = ? AND puuid = ?').get(p.id, puuid) || db.prepare('SELECT * FROM matches WHERE match_id = ? LIMIT 1').get(p.id);
    let raw = store.cachedMatch(p.id);
    if (!raw) {
      try { raw = await store.loadMatch(p.id, rec ? rec.region : 'eu', 0); } catch (err) { throw bad(`Could not load this match: ${err.message}`); }
    }
    if (!raw) throw notFound('This match has no round data.');
    const geo = await assets.mapByName(raw.metadata && raw.metadata.map && raw.metadata.map.name).catch(() => null);
    const out = shapeMatch(raw, puuid, await assets.weaponTable(), geo);
    const review = db.prepare("SELECT v.*, (SELECT COUNT(*) FROM notes n WHERE n.review_id = v.id) AS notes FROM reviews v WHERE v.kind = 'match' AND v.match_id = ? AND v.puuid = ?").get(p.id, puuid) || null;
    const rr = db.prepare('SELECT rr FROM rr WHERE match_id = ? AND puuid = ?').get(p.id, puuid);
    const account = store.accountByPuuid(puuid);
    return { ...out, rr: rr ? rr.rr : null, review, myVod: vod.myGameVod(p.id, puuid), account: account ? { riotId: account.riot_id } : null,
      pro: rec && rec.owner !== 'me' ? rec.owner : null };
  });

  r.get('/api/matches/:id/quick', async (req, res, p) => {
    if (!isId(p.id)) throw bad('Bad match id');
    return quickAnalysis(insights, { matchId: p.id, puuid: String(req.query.puuid || '') });
  });

  const scopeOf = (q) => (q.scope === 'all' || isId(q.scope) ? q.scope : 'default');
  r.get('/api/insights', async (req) => {
    const q = req.query;
    const d = await insights.build({ scope: scopeOf(q), map: clean(q.map, 40), side: ['attack', 'defense'].includes(q.side) ? q.side : '', days: Number(q.days) || 0, role: clean(q.role, 20) });
    return { ...d, accounts: store.accounts().map(store.publicAccount), pros: store.pros().map((x) => ({ id: x.id, name: x.name })) };
  });
  r.get('/api/compare', async (req) => {
    const q = req.query;
    return insights.compare({ scope: scopeOf(q), target: clean(q.target, 60) || 'lobby', role: clean(q.role, 20), side: ['attack', 'defense'].includes(q.side) ? q.side : '', days: Number(q.days) || 0, map: clean(q.map, 40) });
  });
}
