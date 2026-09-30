// Twitch VOD sync (every 2 hours), stream delays (pros 60 s until set, your own 0 s) and where rounds start in a video.
import { getKv, setKv, tx } from './db.js';
import { findPlays, KINDS } from './vodPlays.js';
import { roundStarts } from './matchAnalysis.js';

export const ME = 'me';
export const DEFAULT_PRO_DELAY = 60;
const SYNC_EVERY = 2 * 3600 * 1000;

export function createVod(db, { store, insights, twitch }) {
  const sync = { running: false, at: null, error: null, players: {} };
  const mine = () => ({ twitch: getKv(db, 'my_twitch', null), vodDelay: getKv(db, 'my_vod_delay', null) });

  function delayOf(player) {
    if (player === ME) { const d = mine().vodDelay; return { delay: d ?? 0, checked: d != null }; }
    const p = db.prepare('SELECT vod_delay FROM pros WHERE id = ?').get(player) || {};
    return { delay: p.vod_delay ?? DEFAULT_PRO_DELAY, checked: p.vod_delay != null };
  }
  function setDelay(player, d) {
    if (player === ME) setKv(db, 'my_vod_delay', d);
    else db.prepare('UPDATE pros SET vod_delay = ? WHERE id = ?').run(d, player);
  }

  // re-finding a play keeps what you did with it (reviewed, notes)
  function storePlays(player, plays) {
    const up = db.prepare(`INSERT INTO plays (player, channel, vod_id, vod_start, expires, t, kind, match_id, puuid, round, map, agent, agent_id, role, side, site, label, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (match_id, puuid, round, kind) DO UPDATE SET channel = excluded.channel, vod_id = excluded.vod_id, vod_start = excluded.vod_start,
        expires = excluded.expires, t = excluded.t, label = excluded.label, score = excluded.score, agent_id = excluded.agent_id, role = excluded.role`);
    const before = db.prepare('SELECT COUNT(*) AS n FROM plays WHERE player = ?').get(player).n;
    tx(db, () => { for (const p of plays) up.run(player, p.channel ?? null, p.vod_id, p.vod_start, p.expires ?? null, p.t, p.kind, p.match_id, p.puuid, p.round ?? 0,
      p.map ?? null, p.agent ?? null, p.agent_id ?? null, p.role ?? null, p.side ?? null, p.site ?? null, p.label ?? null, p.score ?? 0); });
    return { found: plays.length, added: db.prepare('SELECT COUNT(*) AS n FROM plays WHERE player = ?').get(player).n - before };
  }

  const find = (opts) => findPlays({ ...opts, cachedMatch: store.cachedMatch, analysed: insights.analysed, roundStarts });

  const vodCache = new Map();
  async function vodsOf(channel) {
    const c = vodCache.get(channel);
    if (c && Date.now() - c.at < 300000) return c.vods;
    const vods = await twitch.vods(channel);
    vodCache.set(channel, { at: Date.now(), vods });
    return vods;
  }

  // "Find my VOD" on the match page
  async function findForMatch(matchId, puuid) {
    const my = mine();
    if (!twitch.enabled()) return { error: 'Add your Twitch Client ID and Secret in Settings first.' };
    if (!my.twitch) return { error: 'Set your Twitch channel in Settings first.' };
    const rec = db.prepare("SELECT match_id, puuid, date FROM matches WHERE owner = 'me' AND match_id = ? AND puuid = ?").get(matchId, puuid);
    if (!rec) return { error: 'Unknown match' };
    vodCache.delete(my.twitch);
    const vods = await vodsOf(my.twitch);
    const plays = await find({ player: ME, channel: my.twitch, vods, delay: delayOf(ME).delay, retention: (vods[0] && vods[0].retention) || 7, records: [rec], kinds: ['game'] });
    storePlays(ME, plays);
    const play = myGameVod(matchId, puuid);
    return play ? { ok: true, play } : { ok: false, reason: vods.length ? 'None of your VODs covers this match (Twitch keeps them 7 days, 14 as Affiliate, 60 as Partner).' : 'Your channel has no VODs. Turn on "Store past broadcasts" in your Twitch settings.' };
  }

  // several triggers in a row run it once
  let soonTimer = null;
  function soon(ms = 20000) {
    if (!twitch.enabled()) return;
    clearTimeout(soonTimer);
    soonTimer = setTimeout(() => { if (sync.running) soon(ms); else runSync().catch(() => {}); }, ms);
    soonTimer.unref();
  }

  async function runSync() {
    if (!twitch.enabled() || sync.running) return status();
    sync.running = true; sync.error = null;
    try {
      for (const p of store.pros().filter((x) => x.twitch)) {
        try {
          const vods = await vodsOf(p.twitch);
          const avatar = twitch.avatarOf(p.twitch);
          // only Twitch's image server is allowed by the page's CSP
          if (avatar && /^https:\/\/static-cdn\.jtvnw\.net\//.test(avatar) && avatar !== p.twitch_avatar) db.prepare('UPDATE pros SET twitch_avatar = ? WHERE id = ?').run(avatar, p.id);
          const plays = await find({ player: p.id, channel: p.twitch, vods, delay: delayOf(p.id).delay, retention: (vods[0] && vods[0].retention) || 60, records: store.proRecords(p.id) });
          sync.players[p.id] = { ok: true, vods: vods.length, ...storePlays(p.id, plays) };
        } catch (err) { sync.players[p.id] = { ok: false, error: err.message }; sync.error = `${p.name}: ${err.message}`; }
      }
      const my = mine();
      if (my.twitch) {
        try {
          const vods = await vodsOf(my.twitch);
          const plays = await find({ player: ME, channel: my.twitch, vods, delay: delayOf(ME).delay, retention: (vods[0] && vods[0].retention) || 7, records: store.myRecords('all'), kinds: ['game'] });
          sync.players[ME] = { ok: true, vods: vods.length, ...storePlays(ME, plays) };
        } catch (err) { sync.players[ME] = { ok: false, error: err.message }; sync.error = `Your channel: ${err.message}`; }
      }
      sync.at = new Date().toISOString();
    } finally { sync.running = false; }
    return status();
  }
  const status = () => ({ enabled: twitch.enabled(), running: sync.running, at: sync.at, error: sync.error, players: sync.players });

  const myGameVod = (matchId, puuid) => db.prepare(`SELECT * FROM plays WHERE player = '${ME}' AND kind = 'game' AND match_id = ? AND puuid = ?`).get(matchId, puuid) || null;

  // offset: video seconds at match time 0
  function roundTimes(raw, offset) {
    if (!raw || offset == null) return [];
    return roundStarts(raw).map((ms, i) => (ms == null ? null : { n: i + 1, at: Math.round((offset + ms / 1000) * 10) / 10 })).filter(Boolean);
  }
  function twitchOffset(play, raw) {
    if (!raw || !raw.metadata || !play.vod_start) return null;
    return (Date.parse(raw.metadata.started_at) - Date.parse(play.vod_start)) / 1000 + delayOf(play.player).delay;
  }
  function timingForPlay(play) {
    const raw = store.cachedMatch(play.match_id);
    const off = twitchOffset(play, raw);
    const d = delayOf(play.player);
    return { offset: off, delay: d.delay, delayChecked: d.checked, rounds: roundTimes(raw, off) };
  }
  function timingForReview(review) {
    const raw = store.cachedMatch(review.match_id);
    if (review.source === 'twitch') {
      const play = review.source_ref ? db.prepare('SELECT * FROM plays WHERE id = ?').get(Number(review.source_ref)) : null;
      if (!play) return { offset: null, rounds: [] };
      return { ...timingForPlay(play), play };
    }
    if (review.source === 'file' || review.source === 'youtube') return { offset: review.offset, delayChecked: review.offset != null, rounds: roundTimes(raw, review.offset) };
    return { offset: null, rounds: [] };
  }

  // "Round N starts here", a nudge or a reset. Twitch moves the channel's delay (all its plays move along);
  // a file or YouTube video moves only this review's offset.
  function calibrate({ review = null, play = null, round, vodTime, nudge, reset }) {
    const raw = store.cachedMatch((review || play).match_id);
    const starts = raw ? roundStarts(raw) : [];
    const isTwitch = !!play || (review && review.source === 'twitch');
    if (isTwitch) {
      const p = play || db.prepare('SELECT * FROM plays WHERE id = ?').get(Number(review.source_ref));
      if (!p) return { error: 'No VOD for this review' };
      const cur = delayOf(p.player);
      let shift;
      if (reset) shift = (p.player === ME ? 0 : DEFAULT_PRO_DELAY) - cur.delay;
      else if (nudge != null) shift = Math.round(Number(nudge));
      else {
        const off = twitchOffset(p, raw), ms = starts[Number(round) - 1];
        if (off == null || ms == null || !Number.isFinite(Number(vodTime))) return { error: 'A round and the video time are needed' };
        shift = Math.round(Number(vodTime) - (off + ms / 1000));
        if (Math.abs(shift) > 600) return { error: `That is ${shift} s away from where the data puts round ${round}. Pause at the start of round ${round} and try again.` };
      }
      const delay = cur.delay + shift;
      if (!reset && delay < -5) return { error: `That would make the delay ${delay} s (the stream ahead of the game). Check that the video is paused at the start of the round you picked.` };
      if (reset) setDelay(p.player, null); else setDelay(p.player, delay);
      db.prepare('UPDATE plays SET t = MAX(0, t + ?) WHERE player = ?').run(shift, p.player);
      return { ok: true, delay: reset ? delayOf(p.player).delay : delay, shift };
    }
    if (!review) return { error: 'Nothing to set' };
    let offset;
    if (reset) offset = null;
    else if (nudge != null) offset = (review.offset ?? 0) + Number(nudge);
    else {
      const ms = starts[Number(round) - 1];
      if (ms == null || !Number.isFinite(Number(vodTime))) return { error: 'A round and the video time are needed' };
      offset = Number(vodTime) - ms / 1000;
    }
    db.prepare("UPDATE reviews SET offset = ?, updated_at = datetime('now') WHERE id = ?").run(offset == null ? null : Math.round(offset * 10) / 10, review.id);
    return { ok: true, offset };
  }

  function start() {
    setTimeout(() => runSync().catch(() => {}), 120000).unref();   // after the start (matches download first)
    setInterval(() => runSync().catch(() => {}), SYNC_EVERY).unref();
  }

  return { runSync, soon, findForMatch, status, delayOf, myGameVod, timingForPlay, timingForReview, calibrate, start, KINDS };
}
