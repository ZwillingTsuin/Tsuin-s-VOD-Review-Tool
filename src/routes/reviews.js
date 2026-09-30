import { getKv, tx } from '../lib/db.js';
import { bad, notFound } from '../lib/http.js';
import { ME } from '../lib/vod.js';
import { KINDS } from '../lib/vodPlays.js';
import { listRecordings, resolveRecording, streamRecording, recordingsFor } from '../lib/recordings.js';
import { DEFAULT_CATEGORIES } from './core.js';
import { appVersion } from '../lib/paths.js';
import { isHtml, sanitizeHtml, plainText, saveImage, imagePath, imagesIn, IMAGE_TYPES } from '../lib/richtext.js';
import fs from 'node:fs';

const clean = (s, max = 4000) => String(s ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const isId = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));
const SOURCES = ['none', 'twitch', 'file', 'youtube'];
const KIND_ORDER = Object.fromEntries(KINDS.map((k, i) => [k, i]));
// points in map units (0..1000)
const TOOLS = new Set(['pen', 'arrow', 'circle', 'line']);
const COLOR = /^#[0-9a-f]{6}$/i;
function cleanStrokes(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 400).filter((s) => s && TOOLS.has(s.t) && COLOR.test(s.c) && Array.isArray(s.p)).map((s) => ({
    t: s.t, c: s.c.toLowerCase(), w: [2, 4, 7].includes(Number(s.w)) ? Number(s.w) : 4,
    p: s.p.slice(0, 2000).filter((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((v) => Number.isFinite(v) && v >= -100 && v <= 1100)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
  })).filter((s) => s.p.length >= (s.t === 'pen' ? 1 : 2));
}

export function reviewRoutes(r, { db, store, vod }) {
  // nothing is read before the user picked a folder
  const recDir = () => getKv(db, 'recordings_dir') || null;
  const proName = (id) => (id === ME ? 'You' : (db.prepare('SELECT name FROM pros WHERE id = ?').get(id) || {}).name || id);
  const avatarOf = (id) => (id === ME ? null : (db.prepare('SELECT twitch_avatar FROM pros WHERE id = ?').get(id) || {}).twitch_avatar || null);
  const reviewRow = (id) => {
    const v = db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM notes n WHERE n.review_id = v.id) AS notes FROM reviews v WHERE v.id = ?`).get(id);
    if (v) v.ratings = v.ratings ? JSON.parse(v.ratings) : null;
    return v;
  };
  const touch = (id) => db.prepare("UPDATE reviews SET updated_at = datetime('now') WHERE id = ?").run(id);
  const matchTitle = (matchId, puuid) => {
    const m = db.prepare('SELECT map, agent, date FROM matches WHERE match_id = ? AND puuid = ?').get(matchId, puuid);
    return m ? `${m.map || 'Match'} · ${m.agent || ''} · ${new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Match review';
  };

  // made on first open
  r.post('/api/reviews', (req) => {
    const b = req.body;
    if (b.kind === 'play') {
      const play = db.prepare('SELECT * FROM plays WHERE id = ?').get(Number(b.play_id));
      if (!play) throw notFound('No such play');
      let v = db.prepare("SELECT id FROM reviews WHERE kind = 'play' AND play_id = ?").get(play.id);
      if (!v) v = { id: db.prepare("INSERT INTO reviews (kind, match_id, puuid, play_id, source, source_ref, title) VALUES ('play', ?, ?, ?, 'twitch', ?, ?)")
        .run(play.match_id, play.puuid, play.id, String(play.id), `${proName(play.player)} · ${play.label || play.kind}`).lastInsertRowid };
      return reviewRow(v.id);
    }
    if (!isId(b.match_id) || !b.puuid) throw bad('A match is needed');
    let v = db.prepare("SELECT id FROM reviews WHERE kind = 'match' AND match_id = ? AND puuid = ?").get(b.match_id, String(b.puuid));
    if (!v) {
      const my = vod.myGameVod(b.match_id, String(b.puuid));
      const source = SOURCES.includes(b.source) ? b.source : my ? 'twitch' : 'none';
      v = { id: db.prepare("INSERT INTO reviews (kind, match_id, puuid, source, source_ref, title) VALUES ('match', ?, ?, ?, ?, ?)")
        .run(b.match_id, String(b.puuid), source, source === 'twitch' && my ? String(my.id) : null, matchTitle(b.match_id, String(b.puuid))).lastInsertRowid };
    }
    return reviewRow(v.id);
  });

  r.get('/api/reviews/:id', (req, res, p) => {
    const review = reviewRow(Number(p.id));
    if (!review) throw notFound('No such review');
    const notes = db.prepare('SELECT * FROM notes WHERE review_id = ? ORDER BY COALESCE(round, 0), COALESCE(t, 0), id').all(review.id);
    const play = review.play_id ? db.prepare('SELECT * FROM plays WHERE id = ?').get(review.play_id) : null;
    if (play) { play.player_name = proName(play.player); play.player_avatar = avatarOf(play.player); }
    return { review, notes, play, timing: play ? vod.timingForPlay(play) : vod.timingForReview(review), categories: getKv(db, 'note_categories') || DEFAULT_CATEGORIES,
      myVod: review.kind === 'match' ? vod.myGameVod(review.match_id, review.puuid) : null };
  });

  r.patch('/api/reviews/:id', (req, res, p) => {
    const cur = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(p.id));
    if (!cur) throw notFound('No such review');
    const b = req.body;
    const source = SOURCES.includes(b.source) ? b.source : cur.source;
    let ref = b.source_ref !== undefined ? (b.source_ref == null ? null : clean(b.source_ref, 500)) : cur.source_ref;
    if (source === 'youtube' && b.source_ref !== undefined && ref) {
      const m = ref.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/) || ref.match(/^([A-Za-z0-9_-]{11})$/);
      if (!m) throw bad('That is not a YouTube link.');
      ref = m[1];
    }
    if (source === 'file' && b.source_ref !== undefined && ref && !resolveRecording(recDir(), ref)) throw bad('That file is not in your recordings folder.');
    const offset = b.offset !== undefined ? (b.offset == null ? null : Number(b.offset)) : source !== cur.source || ref !== cur.source_ref ? null : cur.offset;
    // { focus: 1..5 }, null when skipped
    let ratings = cur.ratings;
    if (b.ratings !== undefined) {
      const clean2 = {};
      if (b.ratings && typeof b.ratings === 'object') for (const [k, v] of Object.entries(b.ratings)) { const n = Math.round(Number(v)); if (k.length <= 40 && n >= 1 && n <= 5) clean2[clean(k, 40)] = n; }
      ratings = Object.keys(clean2).length ? JSON.stringify(clean2) : null;
    }
    db.prepare(`UPDATE reviews SET source = ?, source_ref = ?, offset = ?, ratings = ?, title = ?, summary = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      source, ref, Number.isFinite(offset) ? offset : null, ratings,
      b.title !== undefined ? clean(b.title, 120) || cur.title : cur.title,
      b.summary !== undefined ? clean(b.summary, 20000) : cur.summary,
      b.status === 'done' || b.status === 'open' ? b.status : cur.status, cur.id);
    if (cur.kind === 'play' && b.status === 'done') db.prepare('UPDATE plays SET reviewed = 1 WHERE id = ?').run(cur.play_id);
    return reviewRow(cur.id);
  });
  r.del('/api/reviews/:id', (req, res, p) => { db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(p.id)); return { ok: true }; });

  r.post('/api/reviews/:id/calibrate', (req, res, p) => {
    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(p.id));
    if (!review) throw notFound('No such review');
    const out = vod.calibrate({ review, ...req.body });
    if (out.error) throw bad(out.error);
    return out;
  });

  r.get('/api/reviews', () => {
    const rows = db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM notes n WHERE n.review_id = v.id) AS notes,
        (SELECT COUNT(*) FROM notes n WHERE n.review_id = v.id AND n.starred = 1) AS starred,
        m.map, m.agent, m.agent_id, m.date, m.won, m.rounds_won, m.rounds_lost, m.kills, m.deaths, m.assists,
        p.player, p.kind AS play_kind, p.label AS play_label, p.map AS play_map, p.agent AS play_agent, p.agent_id AS play_agent_id, p.vod_start
      FROM reviews v LEFT JOIN matches m ON m.match_id = v.match_id AND m.puuid = v.puuid LEFT JOIN plays p ON p.id = v.play_id
      ORDER BY v.status = 'done', v.updated_at DESC`).all();
    const reviews = rows.filter((x) => x.notes > 0 || x.status === 'done' || x.summary).map((x) => ({ ...x, player_name: x.player ? proName(x.player) : null }));
    const byCat = db.prepare('SELECT category, COUNT(*) AS n FROM notes GROUP BY category ORDER BY n DESC').all();
    const byWeek = db.prepare("SELECT strftime('%Y-%W', created_at) AS wk, COUNT(*) AS n FROM notes WHERE created_at >= date('now', '-84 days') GROUP BY wk ORDER BY wk").all();
    const rated = reviews.filter((x) => x.ratings && x.kind === 'match').map((x) => ({ at: x.updated_at, r: JSON.parse(x.ratings) }));
    const ratingStats = {};
    for (const { r } of rated) for (const [k, v] of Object.entries(r)) (ratingStats[k] ||= []).push(v);
    const ratingRows = Object.entries(ratingStats).map(([k, vs]) => ({ category: k, n: vs.length, avg: vs.reduce((a, b) => a + b, 0) / vs.length,
      recent: vs.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, vs.length) })).sort((a, b) => b.n - a.n);
    return { reviews: reviews.map((x) => ({ ...x, ratings: x.ratings ? JSON.parse(x.ratings) : null })), stats: { ratings: ratingRows, reviews: reviews.length, done: reviews.filter((x) => x.status === 'done').length, notes: db.prepare('SELECT COUNT(*) AS n FROM notes').get().n,
      lessons: db.prepare('SELECT COUNT(*) AS n FROM notes WHERE starred = 1').get().n, byCategory: byCat, byWeek } };
  });

  const noteBody = (s) => {
    const raw = String(s ?? '');
    if (!isHtml(raw)) return clean(raw);
    const html = sanitizeHtml(raw.slice(0, 60000));
    return plainText(html) || /<img\b/.test(html) ? html : '';
  };
  // rounds [] = whole game, [n] = one round, several are stored as "a,b,c" with round = the first
  const parseRounds = (x) => [...new Set((Array.isArray(x) ? x : []).map((n) => Math.round(Number(n))).filter((n) => n >= 1 && n <= 60))].sort((a, b) => a - b).slice(0, 60);
  const scopeOf = (b, cur = {}) => {
    if (b.rounds !== undefined) {
      const rs = parseRounds(b.rounds);
      // a duel or video time only fits a single round
      const single = rs.length === 1;
      return { round: rs[0] ?? null, rounds: rs.length > 1 ? rs.join(',') : null,
        kill_key: single && b.kill_key ? clean(b.kill_key, 60) : single && b.kill_key === undefined && cur.round === rs[0] ? cur.kill_key ?? null : null,
        t: single && b.t != null && b.t !== '' ? Math.max(0, Math.round(Number(b.t) * 10) / 10) : single && b.t === undefined ? cur.t ?? null : null };
    }
    const t = b.t == null || b.t === '' ? null : Math.max(0, Math.round(Number(b.t) * 10) / 10);
    return { round: b.round == null ? null : Math.round(Number(b.round)) || null, rounds: null, kill_key: b.kill_key ? clean(b.kill_key, 60) : null, t: Number.isFinite(t) ? t : null };
  };
  r.post('/api/notes', (req) => {
    const b = req.body, body = noteBody(b.body), category = clean(b.category, 40);
    if (!body || !category) throw bad('A category and a note are needed');
    const v = db.prepare('SELECT id FROM reviews WHERE id = ?').get(Number(b.review_id));
    if (!v) throw notFound('No such review');
    const sc = scopeOf(b);
    const id = db.prepare('INSERT INTO notes (review_id, round, rounds, kill_key, t, category, body, starred) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(v.id, sc.round, sc.rounds, sc.kill_key, Number.isFinite(sc.t) ? sc.t : null, category, body, b.starred ? 1 : 0).lastInsertRowid;
    touch(v.id);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  });
  r.patch('/api/notes/:id', (req, res, p) => {
    const cur = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(p.id));
    if (!cur) throw notFound('No such note');
    const b = req.body;
    const sc = b.rounds !== undefined ? scopeOf(b, cur) : { round: cur.round, rounds: cur.rounds, kill_key: cur.kill_key, t: cur.t };
    db.prepare("UPDATE notes SET body = ?, category = ?, starred = ?, round = ?, rounds = ?, kill_key = ?, t = ?, updated_at = datetime('now') WHERE id = ?").run(
      b.body !== undefined ? noteBody(b.body) || cur.body : cur.body, b.category !== undefined ? clean(b.category, 40) || cur.category : cur.category,
      b.starred !== undefined ? (b.starred ? 1 : 0) : cur.starred, sc.round, sc.rounds, sc.kill_key, Number.isFinite(sc.t) ? sc.t : null, cur.id);
    touch(cur.review_id);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(cur.id);
  });
  r.del('/api/notes/:id', (req, res, p) => { db.prepare('DELETE FROM notes WHERE id = ?').run(Number(p.id)); return { ok: true }; });

  // → { round: strokes }
  r.get('/api/drawings', (req) => {
    const q = req.query;
    if (!isId(q.match) || !q.puuid) throw bad('A match is needed');
    const out = {};
    for (const d of db.prepare('SELECT round, strokes FROM drawings WHERE match_id = ? AND puuid = ?').all(q.match, String(q.puuid))) { try { out[d.round] = JSON.parse(d.strokes); } catch {} }
    return out;
  });
  r.put('/api/drawings', (req) => {
    const b = req.body;
    if (!isId(b.match_id) || !b.puuid || !Number.isInteger(Number(b.round))) throw bad('A match and a round are needed');
    const strokes = cleanStrokes(b.strokes);
    if (!strokes.length) db.prepare('DELETE FROM drawings WHERE match_id = ? AND puuid = ? AND round = ?').run(b.match_id, String(b.puuid), Number(b.round));
    else db.prepare(`INSERT INTO drawings (match_id, puuid, round, strokes) VALUES (?, ?, ?, ?)
      ON CONFLICT (match_id, puuid, round) DO UPDATE SET strokes = excluded.strokes, updated_at = datetime('now')`).run(b.match_id, String(b.puuid), Number(b.round), JSON.stringify(strokes));
    return { ok: true, strokes: strokes.length };
  });

  r.post('/api/images', (req) => {
    const name = Buffer.isBuffer(req.body) && req.body.length ? saveImage(req.body) : null;
    if (!name) throw bad('That is not a picture (PNG, JPG, WEBP or GIF).');
    return { name, url: `/api/images/${name}` };
  }, { raw: true, bodyLimit: 15 * 1024 * 1024 });
  r.get('/api/images/:name', (req, res, p) => {
    const file = imagePath(p.name);
    if (!file || !fs.existsSync(file)) throw notFound('No such picture');
    const st = fs.statSync(file);
    res.writeHead(200, { 'Content-Type': IMAGE_TYPES[p.name.split('.').pop()], 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
    fs.createReadStream(file).pipe(res);
  });
  r.get('/api/lessons', () => db.prepare(`SELECT n.*, v.kind, v.match_id, v.puuid, v.play_id, v.title AS review_title FROM notes n JOIN reviews v ON v.id = n.review_id
    WHERE n.starred = 1 ORDER BY n.category, n.updated_at DESC`).all());

  // for the "For you" sort
  function myProfile() {
    const recent = store.myRecords('default').slice(0, 100);
    const count = (k) => { const m = new Map(); for (const x of recent) if (x[k]) m.set(x[k], (m.get(x[k]) || 0) + 1); return m; };
    const agents = count('agent'), maps = count('map');
    const roleOf = new Map(db.prepare("SELECT DISTINCT agent, role FROM plays WHERE role IS NOT NULL").all().map((x) => [x.agent, x.role]));
    const roles = new Map(); for (const [a, n] of agents) { const r0 = roleOf.get(a); if (r0) roles.set(r0, (roles.get(r0) || 0) + n); }
    const top = (m, n) => new Set([...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k));
    return { agents: top(agents, 3), roles: top(roles, 1), maps: top(maps, 5) };
  }
  // ?player= &kind= &map= &agent= &role= &status=open|reviewed|all &sort=foryou|best|newest &limit= &offset=
  r.get('/api/plays', (req) => {
    const q = req.query, where = [`player != '${ME}'`, "(expires IS NULL OR expires >= date('now'))"], args = [];
    for (const k of ['player', 'kind', 'map', 'agent', 'role']) if (q[k]) { where.push(`${k} = ?`); args.push(String(q[k])); }
    if (q.status === 'reviewed') where.push('reviewed = 1'); else if (q.status !== 'all') where.push('reviewed = 0');
    const rows = db.prepare(`SELECT p.*, (SELECT v.id FROM reviews v WHERE v.kind = 'play' AND v.play_id = p.id) AS review_id,
      (SELECT COUNT(*) FROM notes n JOIN reviews v ON v.id = n.review_id WHERE v.kind = 'play' AND v.play_id = p.id) AS notes
      FROM plays p WHERE ${where.join(' AND ')} LIMIT 5000`).all(...args);
    const sort = ['foryou', 'best', 'newest'].includes(q.sort) ? q.sort : 'foryou';
    let list;
    if (sort === 'newest') list = rows.sort((a, b) => Date.parse(b.vod_start) - Date.parse(a.vod_start) || a.t - b.t);
    else {
      const me = sort === 'foryou' ? myProfile() : null;
      const fit = (p) => (me ? (me.agents.has(p.agent) ? 3 : me.roles.has(p.role) ? 2 : 0) + (me.maps.has(p.map) ? 1 : 0) : 0);
      // within a kind by fit, then score; the kinds take turns
      const byKind = new Map();
      for (const p of rows) { p.fit = fit(p); (byKind.get(p.kind) || byKind.set(p.kind, []).get(p.kind)).push(p); }
      for (const l of byKind.values()) { l.sort((a, b) => b.fit - a.fit || b.score - a.score || Date.parse(b.vod_start) - Date.parse(a.vod_start)); l.forEach((p, i) => { p.rk = i; }); }
      list = rows.sort((a, b) => a.rk - b.rk || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
    }
    const limit = Math.min(200, Number(q.limit) || 24), offset = Math.max(0, Number(q.offset) || 0);
    return { total: list.length, plays: list.slice(offset, offset + limit).map((p) => ({ ...p, player_name: proName(p.player), player_avatar: avatarOf(p.player) })) };
  });
  r.get('/api/plays/facets', () => {
    const f = `WHERE player != '${ME}' AND (expires IS NULL OR expires >= date('now'))`;
    const count = (col) => db.prepare(`SELECT ${col} AS v, COUNT(*) AS n, SUM(reviewed) AS done FROM plays ${f} AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC`).all();
    return { players: count('player').map((x) => ({ ...x, name: proName(x.v) })), kinds: count('kind'), maps: count('map'), agents: count('agent'), roles: count('role') };
  });
  r.get('/api/plays/:id', (req, res, p) => {
    const play = db.prepare('SELECT * FROM plays WHERE id = ?').get(Number(p.id));
    if (!play) throw notFound('No such play');
    play.player_name = proName(play.player); play.player_avatar = avatarOf(play.player);
    return { play, timing: vod.timingForPlay(play) };
  });
  r.patch('/api/plays/:id', (req, res, p) => {
    if (req.body.reviewed !== undefined) db.prepare('UPDATE plays SET reviewed = ? WHERE id = ?').run(req.body.reviewed ? 1 : 0, Number(p.id));
    return db.prepare('SELECT * FROM plays WHERE id = ?').get(Number(p.id));
  });
  r.post('/api/plays/:id/calibrate', (req, res, p) => {
    const play = db.prepare('SELECT * FROM plays WHERE id = ?').get(Number(p.id));
    if (!play) throw notFound('No such play');
    const out = vod.calibrate({ play, ...req.body });
    if (out.error) throw bad(out.error);
    return out;
  });
  r.post('/api/vod/find-match', async (req) => {
    if (!isId(req.body.match_id)) throw bad('Bad match id');
    const out = await vod.findForMatch(req.body.match_id, String(req.body.puuid || ''));
    if (out.error) throw bad(out.error);
    return out;
  });
  r.get('/api/vod/sync', () => vod.status());
  r.post('/api/vod/sync', async () => {
    if (!vod.status().enabled) throw bad('Add your Twitch Client ID and Secret in Settings first.');
    return vod.runSync();
  });

  r.get('/api/recordings', (req) => {
    const list = listRecordings(recDir());
    if (req.query.match && isId(req.query.match)) {
      const raw = store.cachedMatch(req.query.match);
      list.matching = raw ? recordingsFor(list.files, raw.metadata.started_at, raw.metadata.game_length_in_ms) : [];
    }
    return list;
  });
  r.get('/api/recordings/stream', (req, res) => {
    const full = resolveRecording(recDir(), String(req.query.f || ''));
    if (!full) throw notFound('No such recording');
    streamRecording(req, res, full);
  });

  const TABLES = ['accounts', 'pros', 'pro_accounts', 'reviews', 'notes', 'plays', 'drawings'];
  r.get('/api/export', (req, res) => {
    const data = { app: 'vod-review-tool', version: appVersion(), exported: new Date().toISOString(), tables: {} };
    for (const t of TABLES) data.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    data.images = {};
    for (const name of imagesIn(data.tables.notes.map((n) => n.body))) { const f = imagePath(name); if (f && fs.existsSync(f)) data.images[name] = fs.readFileSync(f).toString('base64'); }
    const body = JSON.stringify(data);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="vod-review-backup-${data.exported.slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
    res.end(body);
  });
  r.post('/api/import', (req) => {
    const d = req.body;
    if (!d || d.app !== 'vod-review-tool' || !d.tables) throw bad('That is not a backup of this app.');
    const counts = {};
    tx(db, () => {
      for (const t of TABLES) {
        const rows = Array.isArray(d.tables[t]) ? d.tables[t] : [];
        const cols = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
        let n = 0;
        for (const row of rows) {
          if (t === 'notes' && row.body != null) row.body = noteBody(row.body);   // a backup file is untrusted input
          if (t === 'drawings') { let st = []; try { st = cleanStrokes(JSON.parse(row.strokes)); } catch {} if (!st.length) continue; row.strokes = JSON.stringify(st); }
          const keys = Object.keys(row).filter((k) => cols.has(k));
          if (!keys.length) continue;
          const res = db.prepare(`INSERT OR IGNORE INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k] ?? null));
          n += res.changes;
        }
        counts[t] = n;
      }
    });
    let images = 0;
    for (const b64 of Object.values(d.images || {})) { try { if (saveImage(Buffer.from(String(b64), 'base64'))) images++; } catch {} }
    counts.images = images;
    return { ok: true, added: counts };
  }, { bodyLimit: 200 * 1024 * 1024 });
}
