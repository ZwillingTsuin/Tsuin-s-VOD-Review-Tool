// Accounts, pros and their matches. An account is checked with one cheap rank request; only when that changed are
// the match list and RR fetched. Full matches download once in the background (they never change after the game).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MATCH_DIR, writeFileAtomic } from './paths.js';
import { getKv, tx } from './db.js';
import { P, HenrikError } from './henrik.js';

const ACCOUNT_EVERY = 10 * 60000;   // every account, cheap unless something happened
const PRO_EVERY = 6 * 3600000;
const HISTORY_STALE = 3 * 3600000;
const now = () => Date.now();
const norm = (s) => String(s || '').trim().toLowerCase();
export function parseRiotId(id) {
  const m = String(id || '').replace(/[\u0000-\u001f]/g, '').match(/^\s*(.+?)\s*#\s*(.+?)\s*$/);
  if (!m || m[1].length > 16 || m[2].length > 5 || /#/.test(m[1] + m[2])) return null;
  return { name: m[1], tag: m[2], full: `${m[1]}#${m[2]}` };
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pro';
const cleanTwitch = (s) => (s ? String(s).trim().toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '').slice(0, 25) || null : null);
// gzipped: ~30 KB instead of ~400 KB. Versions before 0.6 wrote plain .json.
const matchFile = (id) => path.join(MATCH_DIR, String(id).toLowerCase() + '.json.gz');
const oldMatchFile = (id) => path.join(MATCH_DIR, String(id).toLowerCase() + '.json');
const saveMatch = (id, raw) => writeFileAtomic(matchFile(id), zlib.gzipSync(typeof raw === 'string' ? raw : JSON.stringify(raw)));
const isMatchId = (id) => /^[0-9a-f-]{36}$/i.test(String(id || ''));

export function createStore(db, henrik) {
  const listeners = [];
  const onDownloaded = (fn) => listeners.push(fn);
  const doneListeners = [];
  const onBackfillDone = (fn) => doneListeners.push(fn);
  const newMatchListeners = [];
  const onNewMatches = (fn) => newMatchListeners.push(fn);
  const busy = new Set();
  const backfill = { running: false, done: 0, total: 0, failed: 0, current: null };
  const proSync = { running: false, error: null, current: null };

  function cachedMatch(matchId) {
    if (!isMatchId(matchId)) return null;
    try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(matchFile(matchId)))); } catch {}
    try {
      const text = fs.readFileSync(oldMatchFile(matchId), 'utf8');
      try { saveMatch(matchId, text); fs.unlinkSync(oldMatchFile(matchId)); } catch {}
      return JSON.parse(text);
    } catch { return null; }
  }
  const hasMatch = (matchId) => isMatchId(matchId) && (fs.existsSync(matchFile(matchId)) || fs.existsSync(oldMatchFile(matchId)));
  function compressOld() {
    let names = [];
    try { names = fs.readdirSync(MATCH_DIR).filter((f) => /^[0-9a-f-]{36}\.json$/.test(f)); } catch { return; }
    const step = () => {
      for (const f of names.splice(0, 20)) {
        const id = f.slice(0, -5);
        try { saveMatch(id, fs.readFileSync(oldMatchFile(id), 'utf8')); fs.unlinkSync(oldMatchFile(id)); } catch {}
      }
      if (names.length) setTimeout(step, 50).unref();
    };
    step();
  }
  async function loadMatch(matchId, region, prio = P.BG) {
    if (!isMatchId(matchId)) throw new HenrikError('bad match id', 400);
    const cached = cachedMatch(matchId);
    if (cached) return cached;
    const raw = await henrik.get(`/v4/match/${encodeURIComponent(region || 'eu')}/${matchId}`, { prio });
    if (!raw || !raw.rounds || !raw.metadata) return null;
    fs.mkdirSync(MATCH_DIR, { recursive: true });
    saveMatch(matchId, raw);
    rememberFacts(raw);
    for (const fn of listeners) { try { fn(matchId); } catch {} }
    return raw;
  }
  // party size and lobby rank for the match list tags
  function rememberFacts(raw) {
    const players = raw.players || [];
    const up = db.prepare('UPDATE matches SET party = ?, lobby_avg = ? WHERE match_id = ? AND puuid = ?');
    for (const p of players) {
      const party = p.party_id ? players.filter((x) => x.team_id === p.team_id && x.party_id === p.party_id).length : 1;
      const others = players.filter((x) => x.puuid !== p.puuid && x.tier && x.tier.id > 2).map((x) => x.tier.id);
      const avg = others.length >= 5 ? Math.round((others.reduce((a, b) => a + b, 0) / others.length) * 10) / 10 : null;
      up.run(party, avg, raw.metadata.match_id, p.puuid);
    }
  }

  const accounts = () => db.prepare('SELECT * FROM accounts ORDER BY added_at').all();
  const accountBy = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  const accountByPuuid = (pz) => db.prepare('SELECT * FROM accounts WHERE puuid = ?').get(pz);
  const setAccount = (id, patch) => {
    const keys = Object.keys(patch);
    if (keys.length) db.prepare(`UPDATE accounts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), id);
  };

  async function resolveId(riotId, prio) {
    const id = parseRiotId(riotId);
    if (!id) throw new HenrikError('A Riot ID looks like Name#TAG (name up to 16, tag up to 5 characters).', 400);
    try {
      const d = await henrik.get(`/v2/account/${encodeURIComponent(id.name)}/${encodeURIComponent(id.tag)}`, { prio });
      return { puuid: d.puuid, region: String(d.region || 'eu').toLowerCase(), riotId: `${d.name}#${d.tag}` };
    } catch (err) {
      if (err.status === 404) throw new HenrikError(`${id.full} was not found. Check the spelling; brand-new accounts appear after their first match.`, 404);
      throw err;
    }
  }

  async function addAccount(riotId) {
    const id = parseRiotId(riotId);
    if (!id) return { error: 'A Riot ID looks like Name#TAG (name up to 16, tag up to 5 characters).' };
    if (db.prepare('SELECT 1 FROM accounts WHERE riot_id = ?').get(id.full)) return { error: `${id.full} is already on the list.` };
    let r;
    try { r = await resolveId(id.full, P.USER); } catch (err) { return { error: err.message }; }
    if (db.prepare('SELECT 1 FROM accounts WHERE puuid = ?').get(r.puuid)) return { error: `${r.riotId} is already on the list.` };
    const info = db.prepare('INSERT INTO accounts (riot_id, puuid, region, added_at) VALUES (?, ?, ?, ?)').run(r.riotId, r.puuid, r.region, now());
    const acc = accountBy(info.lastInsertRowid);
    refresh(acc, { force: true }).then(() => runBackfill()).catch(() => {});
    return { ok: true, account: publicAccount(acc) };
  }
  function removeAccount(id) {
    const acc = accountBy(id);
    if (!acc) return { error: 'Unknown account' };
    tx(db, () => {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      // the match list rows go (the downloaded match files stay: a pro or another account may be in them)
      if (acc.puuid) db.prepare("DELETE FROM matches WHERE owner = 'me' AND puuid = ?").run(acc.puuid);
    });
    return { ok: true };
  }
  function setAccountInsights(id, on) { setAccount(id, { in_insights: on ? 1 : 0 }); return { ok: true }; }

  function upsertRecords(owner, puuid, region, list) {
    const ins = db.prepare(`INSERT INTO matches (match_id, puuid, owner, date, map, agent, agent_id, region, season, won, rounds_won, rounds_lost, kills, deaths, assists, score, head, body, leg, dmg, tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (match_id, puuid) DO NOTHING`);
    let added = 0;
    tx(db, () => {
      for (const x of list) {
        const st = x.stats || {}, meta = x.meta || {}, mine = String(st.team || '').toLowerCase(), t = x.teams || {};
        const us = t[mine], them = mine === 'red' ? t.blue : t.red;
        if (!meta.id || !meta.started_at) continue;
        const r = ins.run(meta.id, puuid, owner, meta.started_at, meta.map ? meta.map.name : null,
          st.character ? st.character.name : null, st.character && st.character.id ? st.character.id.toLowerCase() : null, region, meta.season ? meta.season.short : null,
          us == null || them == null || us === them ? null : us > them ? 1 : 0, us ?? null, them ?? null,
          st.kills ?? null, st.deaths ?? null, st.assists ?? null, st.score ?? null,
          st.shots ? st.shots.head ?? null : null, st.shots ? st.shots.body ?? null : null, st.shots ? st.shots.leg ?? null : null,
          st.damage ? st.damage.made ?? null : null, st.tier ?? null);
        if (r.changes) added++;
      }
    });
    return added;
  }
  async function listStored(puuid, region, { pages, size, prio }) {
    const out = [];
    for (let page = 1; page <= pages; page++) {
      const r = await henrik.get(`/v1/by-puuid/stored-matches/${encodeURIComponent(region)}/${puuid}?mode=competitive&size=${size}&page=${page}`, { prio, raw: true });
      const list = (r && r.data) || [];
      out.push(...list);
      if (!list.length || !(r.results && r.results.after > 0)) break;
    }
    return out;
  }

  async function refresh(acc, { force = false } = {}) {
    if (!acc || !acc.puuid || busy.has(acc.id)) return { added: 0 };
    busy.add(acc.id);
    const prio = force ? P.USER : P.SYNC, region = acc.region || 'eu';
    let added = 0;
    try {
      const m = await henrik.get(`/v3/by-puuid/mmr/${region}/pc/${acc.puuid}`, { prio }).catch((err) => { if (err.status === 404) return null; throw err; });
      const rank = m && m.current ? { tier: m.current.tier ? m.current.tier.name : 'Unranked', tierId: m.current.tier ? m.current.tier.id : 0, rr: m.current.rr ?? 0, elo: m.current.elo ?? 0,
        peak: m.peak && m.peak.tier ? m.peak.tier.name : null } : null;
      const games = m ? (m.seasonal || []).reduce((s, x) => s + (x.games || 0), 0) : 0;
      const sig = rank ? `${rank.elo}|${m.current.last_change}|${games}` : 'none';
      const stale = !acc.history_at || now() - acc.history_at > HISTORY_STALE;
      setAccount(acc.id, { rank_json: rank ? JSON.stringify(rank) : acc.rank_json, checked_at: now(), error: null });
      // renamed: the puuid stays, the Riot ID follows
      if (m && m.account && m.account.name && m.account.tag) {
        const cur = `${m.account.name}#${m.account.tag}`;
        if (cur !== acc.riot_id && !db.prepare('SELECT 1 FROM accounts WHERE riot_id = ? AND id != ?').get(cur, acc.id)) setAccount(acc.id, { riot_id: cur });
      }
      if (!force && !stale && sig === acc.mmr_sig) return { added: 0 };
      const first = !acc.matches_synced_at;
      const list = await listStored(acc.puuid, region, { pages: first ? 6 : 1, size: first ? 100 : 25, prio });
      added = upsertRecords('me', acc.puuid, region, list);
      // RR per match isn't in the match list
      const h = await henrik.get(`/v2/by-puuid/mmr-history/${region}/pc/${acc.puuid}?size=20`, { prio }).catch(() => null);
      const hist = (h && h.history) || [];
      if (hist.length) {
        const up = db.prepare('INSERT INTO rr (match_id, puuid, rr) VALUES (?, ?, ?) ON CONFLICT (match_id, puuid) DO UPDATE SET rr = excluded.rr');
        tx(db, () => { for (const e of hist) if (e.match_id) up.run(e.match_id, acc.puuid, e.last_change ?? 0); });
      }
      setAccount(acc.id, { mmr_sig: sig, history_at: now(), matches_synced_at: now() });
      if (added) for (const fn of newMatchListeners) { try { fn('me'); } catch {} }
    } catch (err) {
      setAccount(acc.id, { error: err.message });
    } finally { busy.delete(acc.id); }
    return { added };
  }
  async function refreshOne(id) {
    const acc = accountBy(id);
    if (!acc) return { error: 'Unknown account' };
    const r = await refresh(acc, { force: true });
    const after = accountBy(id);
    runBackfill().catch(() => {});
    return after.error ? { error: after.error } : { ok: true, added: r.added };
  }
  async function refreshAll() { for (const a of accounts()) await refresh(a); }

  const pros = () => db.prepare('SELECT * FROM pros ORDER BY added_at').all().map((p) => ({
    ...p, accounts: db.prepare('SELECT riot_id, puuid, region, synced_at, error FROM pro_accounts WHERE pro_id = ?').all(p.id),
  }));
  function addPro({ name, riotIds, twitch }) {
    const ids = (riotIds || []).map(parseRiotId).filter(Boolean);
    const nm = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    if (!nm || !ids.length) return { error: 'A name and at least one Riot ID (Name#TAG) are needed.' };
    let id = slug(nm);
    while (db.prepare('SELECT 1 FROM pros WHERE id = ?').get(id)) id += '-2';
    tx(db, () => {
      db.prepare('INSERT INTO pros (id, name, twitch, added_at) VALUES (?, ?, ?, ?)').run(id, nm, cleanTwitch(twitch), now());
      const ins = db.prepare('INSERT OR IGNORE INTO pro_accounts (pro_id, riot_id) VALUES (?, ?)');
      for (const x of ids) ins.run(id, x.full);
    });
    syncPros({ only: id }).catch(() => {});
    return { ok: true, id };
  }
  function updatePro(id, b) {
    const p = db.prepare('SELECT * FROM pros WHERE id = ?').get(id);
    if (!p) return { error: 'Unknown pro' };
    if (b.name !== undefined) db.prepare('UPDATE pros SET name = ? WHERE id = ?').run(String(b.name).trim().slice(0, 40) || p.name, id);
    if (b.twitch !== undefined) db.prepare('UPDATE pros SET twitch = ? WHERE id = ?').run(cleanTwitch(b.twitch), id);
    if (b.vodDelay !== undefined) db.prepare('UPDATE pros SET vod_delay = ? WHERE id = ?').run(b.vodDelay == null ? null : Math.round(Number(b.vodDelay)), id);
    if (b.matchLimit !== undefined) db.prepare('UPDATE pros SET match_limit = ? WHERE id = ?').run(Math.max(20, Math.min(1000, Math.round(Number(b.matchLimit) || 150))), id);
    if (Array.isArray(b.riotIds)) {
      const ids = b.riotIds.map(parseRiotId).filter(Boolean);
      if (!ids.length) return { error: 'At least one Riot ID is needed.' };
      tx(db, () => {
        const keep = new Set(ids.map((x) => norm(x.full)));
        for (const a of db.prepare('SELECT riot_id FROM pro_accounts WHERE pro_id = ?').all(id)) if (!keep.has(norm(a.riot_id))) db.prepare('DELETE FROM pro_accounts WHERE pro_id = ? AND riot_id = ?').run(id, a.riot_id);
        const ins = db.prepare('INSERT OR IGNORE INTO pro_accounts (pro_id, riot_id) VALUES (?, ?)');
        for (const x of ids) ins.run(id, x.full);
      });
    }
    if (Array.isArray(b.riotIds) || b.matchLimit !== undefined) syncPros({ only: id, force: true }).catch(() => {});
    return { ok: true };
  }
  function removePro(id) {
    tx(db, () => {
      db.prepare('DELETE FROM pros WHERE id = ?').run(id);
      db.prepare('DELETE FROM pro_accounts WHERE pro_id = ?').run(id);
      db.prepare('DELETE FROM matches WHERE owner = ?').run(id);
      db.prepare("DELETE FROM plays WHERE player = ? AND id NOT IN (SELECT play_id FROM reviews WHERE kind = 'play' AND play_id IS NOT NULL)").run(id);
    });
    return { ok: true };
  }
  async function syncPros({ only = null, force = false } = {}) {
    if (proSync.running) return;
    proSync.running = true; proSync.error = null;
    let added = 0;
    try {
      for (const p of pros()) {
        if (only && p.id !== only) continue;
        proSync.current = p.id;
        for (const a of p.accounts) {
          if (!force && a.synced_at && now() - a.synced_at < PRO_EVERY) continue;
          try {
            let { puuid, region } = a;
            if (!puuid) {
              const r = await resolveId(a.riot_id, P.SYNC);
              puuid = r.puuid; region = r.region;
              setProAccount(p.id, a.riot_id, { puuid, region, riot_id: r.riotId });
              a.riot_id = r.riotId;
            } else {
              const acc = await henrik.get(`/v2/by-puuid/account/${puuid}`, { prio: P.SYNC }).catch(() => null);
              const cur = acc && acc.name && acc.tag ? `${acc.name}#${acc.tag}` : null;
              if (cur && cur !== a.riot_id && !db.prepare('SELECT 1 FROM pro_accounts WHERE pro_id = ? AND riot_id = ?').get(p.id, cur)) { setProAccount(p.id, a.riot_id, { riot_id: cur }); a.riot_id = cur; }
            }
            const list = await listStored(puuid, region, { pages: Math.ceil(p.match_limit / 100), size: Math.min(100, p.match_limit), prio: P.SYNC });
            added += upsertRecords(p.id, puuid, region, list.slice(0, p.match_limit));
            setProAccount(p.id, a.riot_id, { synced_at: now(), error: null });
          } catch (err) {
            setProAccount(p.id, a.riot_id, { error: err.message });
            proSync.error = `${a.riot_id}: ${err.message}`;
          }
        }
      }
    } finally { proSync.running = false; proSync.current = null; }
    if (added) for (const fn of newMatchListeners) { try { fn('pros'); } catch {} }
    runBackfill().catch(() => {});
  }
  function setProAccount(proId, riotId, patch) {
    const keys = Object.keys(patch);
    db.prepare(`UPDATE pro_accounts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE pro_id = ? AND riot_id = ?`).run(...keys.map((k) => patch[k] ?? null), proId, riotId);
  }

  async function runBackfill() {
    if (backfill.running || !getKv(db, 'henrik_key')) return;
    backfill.running = true;
    try {
      // yours first, then the pros', newest first
      const mine = db.prepare("SELECT match_id, region FROM matches WHERE owner = 'me' GROUP BY match_id ORDER BY MAX(date) DESC").all();
      const theirs = db.prepare("SELECT match_id, region FROM matches WHERE owner != 'me' GROUP BY match_id ORDER BY MAX(date) DESC").all();
      const seen = new Set(), list = [];
      for (const m of [...mine, ...theirs]) if (!seen.has(m.match_id)) { seen.add(m.match_id); list.push(m); }
      backfill.total = list.length; backfill.done = list.filter((m) => hasMatch(m.match_id)).length; backfill.failed = 0;
      let fresh = 0;
      for (const m of list) {
        if (hasMatch(m.match_id)) continue;
        backfill.current = m.match_id;
        try { if (await loadMatch(m.match_id, m.region, P.BG)) { backfill.done++; fresh++; } else backfill.failed++; }
        catch (err) { backfill.failed++; if (err.status === 401 || err.status === 403) break; }
        // let the VOD matching run every 40 matches, so plays appear while the rest downloads
        if (fresh && fresh % 40 === 0) for (const fn of doneListeners) { try { fn(); } catch {} }
      }
      if (fresh) for (const fn of doneListeners) { try { fn(); } catch {} }
    } finally { backfill.running = false; backfill.current = null; }
  }

  function publicAccount(a) {
    return { id: a.id, riotId: a.riot_id, puuid: a.puuid, region: a.region, inInsights: !!a.in_insights, rank: a.rank_json ? JSON.parse(a.rank_json) : null,
      error: a.error, checkedAt: a.checked_at, syncedAt: a.matches_synced_at,
      syncing: busy.has(a.id) || (!a.matches_synced_at && !a.error),
      matches: a.puuid ? db.prepare("SELECT COUNT(*) AS n FROM matches WHERE owner = 'me' AND puuid = ?").get(a.puuid).n : 0 };
  }
  // scope: 'default' (accounts marked for Insights), 'all', or one puuid
  function myRecords(scope = 'default') {
    const where = scope === 'all' ? '' : scope === 'default' || !scope ? 'AND puuid IN (SELECT puuid FROM accounts WHERE in_insights = 1)' : 'AND puuid = ?';
    const args = scope !== 'all' && scope !== 'default' && scope ? [scope] : [];
    return db.prepare(`SELECT * FROM matches WHERE owner = 'me' AND puuid IN (SELECT puuid FROM accounts) ${where} ORDER BY date DESC`).all(...args);
  }
  const proRecords = (id) => db.prepare('SELECT * FROM matches WHERE owner = ? ORDER BY date DESC').all(id);

  function start() {
    setTimeout(compressOld, 5000).unref();
    const tick = () => refreshAll().catch(() => {}).finally(() => runBackfill().catch(() => {}));
    setTimeout(tick, 1500);
    setInterval(tick, ACCOUNT_EVERY).unref();
    setTimeout(() => syncPros().catch(() => {}), 20000).unref();
    setInterval(() => syncPros().catch(() => {}), PRO_EVERY / 4).unref();   // each account itself waits 6 hours
  }

  return {
    onDownloaded, onBackfillDone, onNewMatches, cachedMatch, hasMatch, loadMatch,
    accounts, accountBy, accountByPuuid, publicAccount, addAccount, removeAccount, setAccountInsights, refreshOne, refreshAll,
    pros, addPro, updatePro, removePro, syncPros, proSyncStatus: () => ({ ...proSync }),
    runBackfill, backfillStatus: () => ({ ...backfill }),
    myRecords, proRecords, start,
  };
}
