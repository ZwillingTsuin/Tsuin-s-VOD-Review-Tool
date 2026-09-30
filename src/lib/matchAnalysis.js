// A raw HenrikDev v4 match → what the match page and the VOD review show. No I/O (tested with a match file).
import { toMinimap, calloutAt, mapInfo } from './mapData.js';

// round win 3000, loss bonus 1900/2400/2900, full buy ~3900 = rifle + heavy shield
export const T = {
  earlyDeathMs: 20000,   // dying in the first 20 s of a round counts as an early death
  tradeWindowMs: 5000,   // a teammate killing your killer within 5 s = you were traded
  fullBuy: 3900,         // rifle (2900) + heavy shield (1000)
  eco: 1600,             // below this on your body = eco / save
  lossBonus: [1900, 2400, 2900],
  winReward: 3000,
};
const LOOK_MS = 3000;   // a victim's last recorded view counts when it is at most 3 s before the death

const clsOf = (loadout) => (loadout >= T.fullBuy ? 'full' : loadout >= T.eco ? 'half' : 'eco');
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const dist3 = (a, b) => (a && b ? Math.round(Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)) / 100) : null);   // game units are cm
const r3 = (x) => Math.round(x * 1000) / 1000;
const uvOf = (geo, loc) => { const p = geo && loc ? toMinimap(geo, loc) : null; return p ? [r3(p.u), r3(p.v)] : null; };
// view_radians is atan2(dy, dx) in game space; the minimap swaps the axes (u from y, v from x)
function facingOf(geo, a) {
  if (!geo || a == null) return null;
  const du = Math.sin(a) * geo.xm, dv = Math.cos(a) * geo.ym, len = Math.hypot(du, dv) || 1;
  return [Math.round((du / len) * 100) / 100, Math.round((dv / len) * 100) / 100];
}
// Red attacks in the first half, sides swap from round 13, overtime alternates every round
export const redAttacks = (i) => (i < 12 ? true : i < 24 ? false : (i - 24) % 2 === 0);

// Agent weapons the weapon list doesn't name (the API leaves the name empty)
const AGENT_WEAPONS = {
  '856d9a7e-4b06-dc37-15dc-9d809c37cb90': 'Headhunter',
  '39099fb5-4293-def4-1e09-2e9080ce7456': 'Tour De Force',
  '95336ae4-45d4-1032-cfaf-6bad01910607': 'Overdrive',
};
const TYPE_NAMES = { Ability: 'Ability', Melee: 'Knife', Fall: 'Fall damage', Weapon: 'Agent weapon' };

// When each round started, in match time (ms): the median of (time in match − time in round) over its kills.
// A round without kills sits between its neighbours.
export function roundStarts(raw) {
  const n = (raw.rounds || []).length, by = new Map();
  for (const k of raw.kills || []) {
    if (k.time_in_match_in_ms == null || k.time_in_round_in_ms == null) continue;
    const x = by.get(k.round) || []; x.push(k.time_in_match_in_ms - k.time_in_round_in_ms); by.set(k.round, x);
  }
  const out = Array.from({ length: n }, (_, i) => (by.has(i) ? median(by.get(i)) : null));
  for (let i = 0; i < n; i++) {
    if (out[i] != null) continue;
    let a = i - 1; while (a >= 0 && out[a] == null) a--;
    let b = i + 1; while (b < n && out[b] == null) b++;
    if (a >= 0 && b < n) out[i] = Math.round(out[a] + ((out[b] - out[a]) * (i - a)) / (b - a));
    else if (a >= 0) out[i] = out[a] + 100000 * (i - a);
    else if (b < n) out[i] = Math.max(0, out[b] - 100000 * (b - i));
  }
  return out;
}

// geo: the map's geometry (assets.mapByName); wt: weapon id → name
export function shapeMatch(g, puuid, wt = new Map(), geo = null) {
  const me = (g.players || []).find((p) => p.puuid === puuid) || null;
  const myTeam = me ? me.team_id : null;
  const n = (g.rounds || []).length || 1;
  const byPuuid = new Map((g.players || []).map((p) => [p.puuid, p]));
  const wname = (w) => (w && w.type === 'Bomb' ? 'Spike' : null) || (w && w.name) || (w && w.id && (wt.get(String(w.id).toLowerCase()) || AGENT_WEAPONS[String(w.id).toLowerCase()]))
    || (w && TYPE_NAMES[w.type]) || 'Unknown';
  const starts = roundStarts(g);

  const ext = new Map((g.players || []).map((p) => [p.puuid, { fk: 0, fd: 0, kast: 0, mk: 0 }]));

  const rounds = (g.rounds || []).map((r, i) => {
    const ks = (g.kills || []).filter((k) => k.round === i).sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms);
    const statOf = new Map((r.stats || []).filter((s) => s.player).map((s) => [s.player.puuid, s]));
    const mine = statOf.get(puuid);
    const hits = new Map();
    for (const s of r.stats || []) for (const e of s.damage_events || []) {
      if (!s.player || !e.player) continue;
      hits.set(`${s.player.puuid}>${e.player.puuid}`, { damage: e.damage || 0, head: e.headshots || 0, body: e.bodyshots || 0, leg: e.legshots || 0 });
    }
    const hit = (a, b) => hits.get(`${a}>${b}`) || { damage: 0, head: 0, body: 0, leg: 0 };
    // the victim is never in the snapshot of their own death: where they looked comes from the last one before it
    const snaps = [...ks.map((k) => ({ t: k.time_in_round_in_ms, pl: k.player_locations || [] })),
      ...[r.plant, r.defuse].filter(Boolean).map((e) => ({ t: e.round_time_in_ms, pl: e.player_locations || [] }))].sort((a, b) => a.t - b.t);
    const lookOf = (pz, t, killerLoc) => {
      for (let x = snaps.length - 1; x >= 0; x--) {
        if (snaps[x].t >= t) continue;
        const p = snaps[x].pl.find((pl) => pl.player && pl.player.puuid === pz);
        if (!p || !p.location || p.view_radians == null) continue;
        if (t - snaps[x].t > LOOK_MS) return null;
        let off = null;
        if (killerLoc) { off = Math.abs(p.view_radians - Math.atan2(killerLoc.y - p.location.y, killerLoc.x - p.location.x)) % (2 * Math.PI); if (off > Math.PI) off = 2 * Math.PI - off; off = Math.round((off * 180) / Math.PI); }
        return { dt: t - snaps[x].t, off, uv: uvOf(geo, p.location), f: facingOf(geo, p.view_radians) };
      }
      return null;
    };
    const attackTeam = redAttacks(i) ? 'Red' : 'Blue';
    const econ = (r.stats || []).filter((s) => s.player).map((s) => ({
      puuid: s.player.puuid, name: s.player.name, team: s.player.team,
      loadout: (s.economy && s.economy.loadout_value) || 0, remaining: (s.economy && s.economy.remaining) || 0,
      weapon: s.economy ? wname(s.economy.weapon) : null, armor: s.economy && s.economy.armor ? s.economy.armor.name : null,
    }));
    const econOf = (pz) => econ.find((e) => e.puuid === pz) || {};
    const teamSize = (team) => econ.filter((e) => e.team === team).length || 5;

    const dead = new Set(), kast = new Set(), killsBy = new Map();
    const aliveOf = (team) => teamSize(team) - [...dead].filter((pz) => (econOf(pz).team || (byPuuid.get(pz) || {}).team_id) === team).length;
    let firstDone = false;
    const kills = ks.map((k, j) => {
      const killer = k.killer && k.killer.puuid, victim = k.victim && k.victim.puuid;
      const kTeam = k.killer && k.killer.team, vTeam = k.victim && k.victim.team;
      const spike = !!(k.weapon && k.weapon.type === 'Bomb') || (killer && killer === victim);
      const aliveBefore = { killerTeam: aliveOf(kTeam), victimTeam: aliveOf(vTeam) };
      dead.add(victim);
      const kp = (k.player_locations || []).find((pl) => pl.player && pl.player.puuid === killer);
      const wid = k.weapon && k.weapon.type === 'Weapon' && k.weapon.id ? String(k.weapon.id).toLowerCase() : null;
      const t = k.time_in_round_in_ms;
      const isFirst = !spike && !firstDone;
      if (isFirst) { firstDone = true; ext.get(killer) && ext.get(killer).fk++; ext.get(victim) && ext.get(victim).fd++; }
      if (!spike) {
        kast.add(killer); for (const as of k.assistants || []) kast.add(as.puuid);
        killsBy.set(killer, (killsBy.get(killer) || 0) + 1);
      }
      const traded = ks.slice(j + 1).find((x) => x.victim && x.victim.puuid === killer && x.killer && x.killer.team === vTeam && x.time_in_round_in_ms - t <= T.tradeWindowMs);
      if (traded && !spike) kast.add(victim);
      const tradeOf = ks.slice(0, j).reverse().find((x) => x.killer && x.killer.puuid === victim && x.victim && x.victim.team === kTeam && t - x.time_in_round_in_ms <= T.tradeWindowMs);
      const killerDied = ks.slice(j + 1).find((x) => x.victim && x.victim.puuid === killer && x.time_in_round_in_ms - t <= T.tradeWindowMs);
      const facts = spike ? null : {
        alive: aliveBefore,
        killerWeapon: wname(k.weapon), victimWeapon: econOf(victim).weapon || null,
        killerLoadout: econOf(killer).loadout || 0, victimLoadout: econOf(victim).loadout || 0,
        dist: dist3(kp && kp.location, k.location),
        onVictim: hit(killer, victim), onKiller: hit(victim, killer),
        tradedBy: traded ? traded.killer.name : null, tradedAfterMs: traded ? traded.time_in_round_in_ms - t : null,
        tradeOf: tradeOf ? tradeOf.victim.name : null,
        killerDiedAfterMs: killerDied ? killerDied.time_in_round_in_ms - t : null,
      };
      return {
        key: `${i + 1}:${k.time_in_match_in_ms}`, t, tMatch: k.time_in_match_in_ms, first: isFirst, weapon: wname(k.weapon),
        weaponId: wid && wt.has(wid) ? wid : null, weaponType: k.weapon ? k.weapon.type || null : null,
        vUV: uvOf(geo, k.location), kUV: uvOf(geo, kp && kp.location),
        vCall: geo && k.location ? (calloutAt(geo, k.location) || {}).name || null : null,
        kCall: geo && kp && kp.location ? (calloutAt(geo, kp.location) || {}).name || null : null,
        pos: geo ? (k.player_locations || []).filter((pl) => pl.player && pl.location).map((pl) => ({ p: pl.player.puuid, team: pl.player.team, uv: uvOf(geo, pl.location), f: facingOf(geo, pl.view_radians) })) : [],
        vLook: victim && !spike ? lookOf(victim, t, kp && kp.location) : null,
        killer: k.killer && k.killer.name, killerPuuid: killer, killerTeam: kTeam,
        victim: k.victim && k.victim.name, victimPuuid: victim, victimTeam: vTeam,
        assists: (k.assistants || []).map((a) => a.puuid),
        spike, facts,
        mine: killer === puuid && !spike ? 'kill' : victim === puuid ? 'death' : (k.assistants || []).some((a) => a.puuid === puuid) ? 'assist' : null,
      };
    });
    for (const pz of ext.keys()) if (!dead.has(pz)) kast.add(pz);   // survived
    for (const pz of kast) if (ext.has(pz)) ext.get(pz).kast++;
    for (const [pz, nk] of killsBy) if (nk >= 2 && ext.has(pz)) ext.get(pz).mk++;

    return {
      n: i + 1, start: starts[i], winner: r.winning_team, won: myTeam ? r.winning_team === myTeam : null, result: r.result,
      side: myTeam ? (myTeam === attackTeam ? 'attack' : 'defense') : null, attackTeam,
      plant: r.plant ? { site: r.plant.site, t: r.plant.round_time_in_ms, by: r.plant.player && r.plant.player.name, byMe: !!(r.plant.player && r.plant.player.puuid === puuid), uv: uvOf(geo, r.plant.location) } : null,
      defuse: r.defuse ? { t: r.defuse.round_time_in_ms, by: r.defuse.player && r.defuse.player.name, byMe: !!(r.defuse.player && r.defuse.player.puuid === puuid), uv: uvOf(geo, r.defuse.location) } : null,
      me: mine ? {
        kills: (mine.stats && mine.stats.kills) || 0, score: (mine.stats && mine.stats.score) || 0,
        damage: (mine.damage_events || []).reduce((s, e) => s + (e.damage || 0), 0),
        weapon: mine.economy ? wname(mine.economy.weapon) : null, armor: mine.economy && mine.economy.armor ? mine.economy.armor.name : null,
        loadout: mine.economy ? mine.economy.loadout_value : null, remaining: mine.economy ? mine.economy.remaining : null,
        died: ks.some((k) => k.victim && k.victim.puuid === puuid),
      } : null,
      econ, kills,
    };
  });

  const players = (g.players || []).map((p) => {
    const s = p.stats || {}, shots = (s.headshots || 0) + (s.bodyshots || 0) + (s.legshots || 0), x = ext.get(p.puuid) || {};
    const dealt = (s.damage && s.damage.dealt) || 0, received = (s.damage && s.damage.received) || 0;
    return {
      puuid: p.puuid, name: p.name, tag: p.tag, team: p.team_id, party: p.party_id,
      agent: p.agent && p.agent.name, agentId: p.agent && p.agent.id ? p.agent.id.toLowerCase() : null,
      tier: p.tier ? p.tier.id : null, tierName: p.tier ? p.tier.name : null, level: p.account_level ?? null,
      kills: s.kills || 0, deaths: s.deaths || 0, assists: s.assists || 0, acs: Math.round((s.score || 0) / n),
      kd: s.deaths ? Math.round(((s.kills || 0) / s.deaths) * 10) / 10 : s.kills || 0,
      adr: Math.round(dealt / n), ddDelta: Math.round((dealt - received) / n), hs: shots ? Math.round((100 * (s.headshots || 0)) / shots) : null,
      kast: Math.round((100 * (x.kast || 0)) / n), fk: x.fk || 0, fd: x.fd || 0, mk: x.mk || 0,
      ult: (p.ability_casts && p.ability_casts.ultimate) || 0,
      isMe: p.puuid === puuid,
    };
  }).sort((a, b) => b.acs - a.acs);

  const duels = me ? findDuels(rounds, puuid, myTeam) : [];
  const economy = me ? analyseEconomy(rounds, puuid, myTeam) : [];
  const us = rounds.filter((r) => r.won === true).length, them = rounds.filter((r) => r.won === false).length;
  const sum = (f) => rounds.reduce((s, r) => s + f(r), 0);
  const teamTier = (team) => { const ts = players.filter((p) => p.team === team && p.tier > 2).map((p) => p.tier); return ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length) : null; };
  const info = geo ? mapInfo(geo) : null;
  return {
    match_id: g.metadata && g.metadata.match_id, map: g.metadata && g.metadata.map && g.metadata.map.name,
    started_at: g.metadata && g.metadata.started_at, queue: g.metadata && g.metadata.queue && g.metadata.queue.name,
    me: me ? { puuid, team: myTeam, name: me.name, tag: me.tag } : null,
    score: { us, them }, won: us === them ? null : us > them,
    avgTier: { us: teamTier(myTeam || 'Blue'), them: teamTier(myTeam === 'Red' ? 'Blue' : 'Red'), all: (() => { const ts = players.filter((p) => p.tier > 2).map((p) => p.tier); return ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length) : null; })() },
    summary: me ? {
      firstKills: sum((r) => (r.kills.find((k) => k.first) || {}).mine === 'kill' ? 1 : 0),
      firstDeaths: sum((r) => (r.kills.find((k) => k.first) || {}).mine === 'death' ? 1 : 0),
      multiKills: sum((r) => (r.me && r.me.kills >= 3 ? 1 : 0)),
      plants: sum((r) => (r.plant && r.plant.byMe ? 1 : 0)),
      survived: sum((r) => (r.me && !r.me.died ? 1 : 0)),
    } : null,
    players, rounds, duels, economy, teamEconomy: teamEconomy(rounds, myTeam || 'Blue'),
    callouts: info ? info.callouts : [], minimap: info ? info.minimap : null,
  };
}

export function findDuels(rounds, puuid, myTeam) {
  const out = [];
  for (const r of rounds) {
    r.kills.forEach((k) => {
      if (k.spike || (k.killerPuuid !== puuid && k.victimPuuid !== puuid)) return;
      const kind = k.killerPuuid === puuid ? 'kill' : 'death', f = k.facts;
      const alive = kind === 'kill' ? { us: f.alive.killerTeam, them: f.alive.victimTeam } : { us: f.alive.victimTeam, them: f.alive.killerTeam };
      const flags = [];
      if (kind === 'death') {
        const teammatesLeft = alive.us - 1;
        if (k.t < T.earlyDeathMs) flags.push('early');
        if (k.first) flags.push('first-death');
        if (!f.tradedBy && teammatesLeft > 0) flags.push('not-traded');
        if (!f.onKiller.damage) flags.push('no-damage');
        if (alive.us > alive.them) flags.push('man-advantage');
        if (f.victimLoadout >= T.fullBuy && f.killerLoadout < T.eco) flags.push('lost-to-eco');
      } else {
        if (k.first) flags.push('first-blood');
        if (f.tradeOf) flags.push('traded-teammate');
        if (f.killerDiedAfterMs != null) flags.push('traded-back');
      }
      out.push({ key: k.key, round: r.n, kind, won: r.won, side: r.side, t: k.t, opponent: kind === 'kill' ? k.victim : k.killer, flags });
    });
  }
  return out;
}

export function analyseEconomy(rounds, puuid, myTeam) {
  let lossStreak = 0;
  return rounds.map((r, i) => {
    if (i === 0 || i === 12) lossStreak = 0;   // halves start fresh
    const pistol = i === 0 || i === 12;
    const team = r.econ.filter((e) => e.team === myTeam), enemy = r.econ.filter((e) => e.team !== myTeam);
    const mine = team.find((e) => e.puuid === puuid) || { loadout: 0, remaining: 0 };
    const teamMed = median(team.map((e) => e.loadout)), enemyMed = median(enemy.map((e) => e.loadout));
    const myCls = pistol ? 'pistol' : clsOf(mine.loadout), teamCls = pistol ? 'pistol' : clsOf(teamMed), enemyCls = pistol ? 'pistol' : clsOf(enemyMed);
    const prev = rounds[i - 1];
    const bonus = !pistol && prev && (i === 1 || i === 13) && prev.won === true;
    const nextLoss = T.lossBonus[Math.min(lossStreak, 2)];
    const bank = mine.loadout + mine.remaining;
    const flags = [];
    if (!pistol && !bonus) {
      if (teamCls === 'full' && myCls !== 'full') {
        if (bank >= T.fullBuy) flags.push({ key: 'could-full', text: `Team full-bought; you had about ${bank} and went ${myCls}.` });
        else flags.push({ key: 'short', text: `Team full-bought but you couldn't afford it (${bank}). A teammate could have dropped.` });
      }
      if (teamCls === 'eco' && mine.loadout >= T.eco) flags.push({ key: 'desync-buy', text: `Team saved (median ${teamMed}); you bought ${mine.weapon || 'gear'} for ${mine.loadout}.` });
      if (myCls === 'half' && mine.remaining + nextLoss < T.fullBuy) flags.push({ key: 'breaks-next', text: `Half buy leaves ${mine.remaining}: a loss pays ${nextLoss}, so no full buy next round.` });
      const poorMate = team.find((e) => e.puuid !== puuid && e.loadout < T.eco);
      if (teamCls === 'full' && myCls === 'full' && mine.remaining >= 2900 && poorMate) flags.push({ key: 'could-drop', text: `You kept ${mine.remaining} while ${poorMate.name} played with ${poorMate.loadout}. A drop was possible.` });
    }
    if (mine.remaining >= 8000) flags.push({ key: 'near-cap', text: `${mine.remaining} unspent, close to the 9000 cap.` });
    if (r.won === false) lossStreak++; else if (r.won === true) lossStreak = 0;
    return {
      n: r.n, won: r.won, side: r.side, pistol, bonus,
      me: { loadout: mine.loadout, remaining: mine.remaining, weapon: mine.weapon, armor: mine.armor, cls: myCls },
      team: { median: teamMed, cls: teamCls }, enemy: { median: enemyMed, cls: enemyCls },
      flags,
    };
  });
}

export function teamEconomy(rounds, myTeam) {
  const totals = rounds.map((r) => {
    const t = (team) => {
      const es = r.econ.filter((e) => (team === 'us' ? e.team === myTeam : e.team !== myTeam));
      const loadout = es.reduce((s, e) => s + e.loadout, 0), bank = es.reduce((s, e) => s + e.remaining, 0);
      return { loadout, bank, total: loadout + bank, cls: clsOf(median(es.map((e) => e.loadout))) };
    };
    const first = r.kills.find((k) => k.first);
    return { n: r.n, won: r.won, result: r.result, side: r.side, us: t('us'), them: t('them'), firstKill: first ? (first.killerTeam === myTeam ? 'us' : 'them') : null };
  });
  const avg = (k, side) => Math.round(totals.reduce((s, x) => s + x[side][k], 0) / Math.max(1, totals.length));
  return { rounds: totals, avg: { bank: { us: avg('bank', 'us'), them: avg('bank', 'them') }, loadout: { us: avg('loadout', 'us'), them: avg('loadout', 'them') } } };
}
