// Each match is analysed once for all ten players (cached), so the same numbers exist for you, your lobbies and pros.
// Limits of the data: positions only at kills and plants; hits per opponent per round with no misses or order (a
// "one-bullet kill" is the closest thing to first-bullet accuracy); ability casts only as match totals.
import fs from 'node:fs';
import path from 'node:path';
import { ANALYSIS_DIR, writeFileAtomic } from './paths.js';
import * as M from './mapData.js';
import * as assets from './assets.js';
import { redAttacks } from './matchAnalysis.js';

export const VERSION = 1;   // bump when the per-match analysis changes, so cached analyses are rebuilt
export const T = {
  tradeWindowMs: 5000,     // teammate kills your killer within 5 s = traded
  earlyMs: 20000,          // dying in the first 20 s
  roleEarlyMs: 25000,      // controller / sentinel dying this early is flagged
  isolatedM: 15,           // nearest living teammate further than this = nobody could trade you
  isolatedFlagM: 20,       // flagged round: attack before the plant with nobody within 20 m (defense anchors are alone by design)
  earlyPlantMs: 25000,     // a fast plant
  onSpikeM: 12,            // dying within 12 m of the spike after a plant = on site instead of holding space
  upPlayers: 2,            // dying while your team is up 2+ players
  lookWindowMs: 3000,      // the victim's last recorded view counts when it is at most 3 s before the death
  lookAwayDeg: 60,         // killer more than 60° off that view = killed while looking elsewhere
  commonSpots: 0.6,        // the callouts that hold 60% of the lobby's deaths (per map and side) are where fights normally happen
  rareSpot: 0.02,          // a callout with under 2% of the lobby's deaths is an unusual place to die
  mySpotRatio: 1.8,        // you die at a callout 1.8× as often as the lobby, 4+ times and clearly (z ≥ 2) = your spot
};
const SEVERITY = { 'entry-untraded': 3, 'plant-on-site': 3, 'up-players': 3, isolated: 2, 'role-early': 2 };
export const BANDS = ['under 10 m', '10 to 20 m', '20 to 30 m', '30 m and more'];
const band = (d) => (d == null ? null : BANDS[d < 10 ? 0 : d < 20 ? 1 : d < 30 ? 2 : 3]);
export const PHASES = ['0 to 15 s', '15 to 30 s', '30 to 45 s', '45 to 60 s', 'after 60 s', 'after the plant'];
const phase = (t, postPlant) => (postPlant ? PHASES[5] : PHASES[Math.min(4, Math.floor(t / 15000))]);
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) / 100 : null);
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const rate = (a, b) => (b ? a / b : null);
const r3 = (x) => Math.round(x * 1000) / 1000;

export function analyseMatch(raw, map, roles) {
  const meta = raw.metadata || {};
  const players = {};
  for (const p of raw.players || []) {
    const agentId = p.agent && p.agent.id ? p.agent.id.toLowerCase() : null;
    const st = p.stats || {}, casts = p.ability_casts || {};
    players[p.puuid] = {
      name: p.name, tag: p.tag, team: p.team_id, agent: p.agent && p.agent.name, agentId,
      role: ((agentId && roles.get(agentId)) || {}).role || null, tier: p.tier ? p.tier.id : null, tierName: p.tier ? p.tier.name : null,
      score: st.score || 0, k: st.kills || 0, d: st.deaths || 0, a: st.assists || 0,
      casts: (casts.grenade || 0) + (casts.ability1 || 0) + (casts.ability2 || 0),   // no ultimates: they depend on orbs
      ult: casts.ultimate || 0, party: p.party_id || null,
    };
  }
  const rounds = [], kills = [];
  (raw.rounds || []).forEach((r, i) => {
    const sideOf = (team) => ((team === 'Red') === redAttacks(i) ? 'attack' : 'defense');
    const plant = r.plant ? { t: r.plant.round_time_in_ms, site: r.plant.site, loc: r.plant.location, team: r.plant.player && r.plant.player.team } : null;
    const round = { n: i + 1, winner: r.winning_team, atk: redAttacks(i) ? 'Red' : 'Blue', result: r.result, plant, dmg: {}, kast: [], dead: [] };
    rounds.push(round);
    const hits = new Map();
    const econ = new Map();
    for (const s of r.stats || []) {
      if (!s.player) continue;
      econ.set(s.player.puuid, { weapon: s.economy && s.economy.weapon ? s.economy.weapon.name : null, loadout: s.economy ? s.economy.loadout_value : 0 });
      let dmg = 0;
      for (const e of s.damage_events || []) { if (!e.player) continue; dmg += e.damage || 0; hits.set(`${s.player.puuid}>${e.player.puuid}`, { head: e.headshots || 0, body: e.bodyshots || 0, leg: e.legshots || 0, dmg: e.damage || 0 }); }
      round.dmg[s.player.puuid] = dmg;
    }
    const ks = (raw.kills || []).filter((k) => k.round === i).sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms);
    const snaps = [...ks.map((k) => ({ t: k.time_in_round_in_ms, pl: k.player_locations || [] })),
      ...[r.plant, r.defuse].filter(Boolean).map((e) => ({ t: e.round_time_in_ms, pl: e.player_locations || [] }))].sort((a, b) => a.t - b.t);
    const lastSeen = (pz, t) => {
      for (let x = snaps.length - 1; x >= 0; x--) {
        if (snaps[x].t >= t) continue;
        const me = snaps[x].pl.find((pl) => pl.player && pl.player.puuid === pz);
        if (me && me.location && me.view_radians != null) return { dt: t - snaps[x].t, loc: me.location, a: me.view_radians };
      }
      return null;
    };
    const dead = new Set(), kast = new Set();
    const teamSize = (team) => Object.values(players).filter((p) => p.team === team).length || 5;
    let firstDone = false;
    ks.forEach((k, j) => {
      const killer = k.killer && k.killer.puuid, victim = k.victim && k.victim.puuid;
      const spike = (k.weapon && k.weapon.type === 'Bomb') || killer === victim;
      const kTeam = k.killer && k.killer.team, vTeam = k.victim && k.victim.team;
      const aliveOf = (team) => teamSize(team) - [...dead].filter((pz) => (players[pz] || {}).team === team).length;
      const aliveBefore = { killerTeam: aliveOf(kTeam), victimTeam: aliveOf(vTeam) };
      dead.add(victim);
      if (spike) return;
      const first = !firstDone; firstDone = true;
      kast.add(killer);
      for (const as of k.assistants || []) kast.add(as.puuid);
      const locs = (k.player_locations || []).filter((pl) => pl.player).map((pl) => ({ puuid: pl.player.puuid, team: pl.player.team, loc: pl.location }));
      const kLoc = (locs.find((l) => l.puuid === killer) || {}).loc || null, vLoc = k.location || null;
      const mates = locs.filter((l) => l.team === vTeam && l.puuid !== victim).map((l) => dist(l.loc, vLoc)).filter((d) => d != null);
      const traded = ks.slice(j + 1).find((x) => x.victim && x.victim.puuid === killer && x.killer && x.killer.team === vTeam && x.time_in_round_in_ms - k.time_in_round_in_ms <= T.tradeWindowMs);
      if (traded) kast.add(victim);
      const tradeKill = ks.slice(0, j).reverse().find((x) => x.killer && x.killer.puuid === victim && x.victim && x.victim.team === kTeam && k.time_in_round_in_ms - x.time_in_round_in_ms <= T.tradeWindowMs);
      const h = hits.get(`${killer}>${victim}`) || { head: 0, body: 0, leg: 0 };
      const postPlant = plant && k.time_in_round_in_ms > plant.t;
      const seen = lastSeen(victim, k.time_in_round_in_ms);
      let look = null;
      if (seen && kLoc && seen.dt <= T.lookWindowMs) {
        const toKiller = Math.atan2(kLoc.y - seen.loc.y, kLoc.x - seen.loc.x);
        let off = Math.abs(seen.a - toKiller) % (2 * Math.PI);
        if (off > Math.PI) off = 2 * Math.PI - off;
        look = { dt: seen.dt, off: Math.round((off * 180) / Math.PI) };
      }
      const kUV = M.toMinimap(map, kLoc), vUV = M.toMinimap(map, vLoc);
      kills.push({
        round: i + 1, t: k.time_in_round_in_ms, first,
        killer, victim, kTeam, vTeam, kSide: sideOf(kTeam), vSide: sideOf(vTeam),
        weapon: k.weapon && k.weapon.name ? k.weapon.name : k.weapon && k.weapon.type === 'Ability' ? 'Ability' : null,
        vWeapon: (econ.get(victim) || {}).weapon || null,
        d: dist(kLoc, vLoc),
        kUV: kUV ? { u: r3(kUV.u), v: r3(kUV.v) } : null, vUV: vUV ? { u: r3(vUV.u), v: r3(vUV.v) } : null,
        kCall: (M.calloutAt(map, kLoc) || {}).name || null, vCall: (M.calloutAt(map, vLoc) || {}).name || null,
        kSpace: M.spaceIndex(map, kLoc, sideOf(kTeam)), vSpace: M.spaceIndex(map, vLoc, sideOf(vTeam)),
        iso: mates.length ? Math.min(...mates) : null, matesAlive: mates.length,
        traded: !!traded, tradeKill: !!tradeKill,
        hits: h, oneTap: h.head === 1 && h.body === 0 && h.leg === 0,
        aliveBefore, postPlant: !!postPlant,
        spikeD: postPlant && plant.loc ? dist(plant.loc, vLoc) : null,
        back: (hits.get(`${victim}>${killer}`) || {}).dmg || 0,
        look,
      });
    });
    for (const pz of Object.keys(players)) if (!dead.has(pz)) kast.add(pz);
    round.kast = [...kast];
    round.dead = [...dead];
  });
  return { v: VERSION, match_id: meta.match_id, map: meta.map && meta.map.name, date: meta.started_at, nRounds: rounds.length, players, rounds, kills };
}

// entries: [{ a, puuid }]; side: '' | 'attack' | 'defense'. The raw counts are kept for the significance test.
export function playerStats(entries, side = '') {
  const c = { rounds: 0, kills: 0, deaths: 0, fk: 0, fd: 0, fdTraded: 0, tradedDeaths: 0, tradeKills: 0, earlyDeaths: 0, isolated: 0, deathsWithMates: 0,
    oneTaps: 0, head: 0, hitsAll: 0, dmg: 0, kast: 0, survived: 0, multi: 0, upDeaths: 0, ppDeaths: 0, ppOnSpike: 0, casts: 0, castRounds: 0 };
  const arr = { deathT: [], deathSpace: [], killSpace: [], iso: [], contactT: [], killD: [], deathD: [], ppSpikeD: [] };
  const byPhase = Object.fromEntries(PHASES.map((p) => [p, 0]));
  const byBand = Object.fromEntries(BANDS.map((b) => [b, { won: 0, lost: 0 }]));
  for (const { a, puuid } of entries) {
    const me = a.players[puuid];
    if (!me) continue;
    const sideOfRound = (r) => (r.atk === me.team ? 'attack' : 'defense');
    const inSide = new Set(a.rounds.filter((r) => !side || sideOfRound(r) === side).map((r) => r.n));
    c.rounds += inSide.size;
    c.casts += me.casts; c.castRounds += a.nRounds;
    const perRound = new Map();
    for (const r of a.rounds) {
      if (!inSide.has(r.n)) continue;
      c.dmg += r.dmg[puuid] || 0;
      if (r.kast.includes(puuid)) c.kast++;
      if (!r.dead.includes(puuid)) c.survived++;
    }
    for (const k of a.kills) {
      if (!inSide.has(k.round)) continue;
      const mine = k.killer === puuid, died = k.victim === puuid;
      if (!mine && !died) continue;
      if (!perRound.has(k.round)) { perRound.set(k.round, 0); arr.contactT.push(k.t); }
      if (mine) {
        perRound.set(k.round, perRound.get(k.round) + 1);
        c.kills++; if (k.first) c.fk++; if (k.tradeKill) c.tradeKills++; if (k.oneTap) c.oneTaps++;
        c.head += k.hits.head; c.hitsAll += k.hits.head + k.hits.body + k.hits.leg;
        if (k.kSpace != null) arr.killSpace.push(k.kSpace);
        if (k.d != null) { arr.killD.push(k.d); byBand[band(k.d)].won++; }
      }
      if (died) {
        c.deaths++; if (k.first) { c.fd++; if (k.traded) c.fdTraded++; } if (k.traded) c.tradedDeaths++; if (k.t < T.earlyMs) c.earlyDeaths++;
        arr.deathT.push(k.t); if (k.vSpace != null) arr.deathSpace.push(k.vSpace);
        if (k.d != null) { arr.deathD.push(k.d); byBand[band(k.d)].lost++; }
        byPhase[phase(k.t, k.postPlant)]++;
        if (k.matesAlive) { c.deathsWithMates++; if (k.iso > T.isolatedM) c.isolated++; arr.iso.push(k.iso); }
        if (k.aliveBefore.victimTeam - k.aliveBefore.killerTeam >= T.upPlayers) c.upDeaths++;
        if (k.postPlant && k.vSide === 'attack' && k.spikeD != null) { c.ppDeaths++; arr.ppSpikeD.push(k.spikeD); if (k.spikeD < T.onSpikeM) c.ppOnSpike++; }
      }
    }
    for (const nk of perRound.values()) if (nk >= 2) c.multi++;
  }
  return {
    c, arr, byPhase, byBand,
    rounds: c.rounds, kills: c.kills, deaths: c.deaths, openings: c.fk + c.fd,
    kpr: rate(c.kills, c.rounds), dpr: rate(c.deaths, c.rounds), adr: rate(c.dmg, c.rounds), kast: rate(c.kast, c.rounds), survival: rate(c.survived, c.rounds),
    multiPct: rate(c.multi, c.rounds),
    fkpr: rate(c.fk, c.rounds), fdpr: rate(c.fd, c.rounds), openingWin: rate(c.fk, c.fk + c.fd), fdTradedPct: rate(c.fdTraded, c.fd),
    tradedPct: rate(c.tradedDeaths, c.deaths), tradeKillPct: rate(c.tradeKills, c.kills),
    earlyDeathPct: rate(c.earlyDeaths, c.deaths), medianDeathT: med(arr.deathT), medianContactT: med(arr.contactT),
    isolatedPct: rate(c.isolated, c.deathsWithMates), medianIso: med(arr.iso), upDeathsPr: rate(c.upDeaths, c.rounds),
    oneTapPct: rate(c.oneTaps, c.kills), killHsPct: rate(c.head, c.hitsAll),
    spaceAtDeath: med(arr.deathSpace), spaceAtKill: med(arr.killSpace),
    medianKillD: med(arr.killD), medianDeathD: med(arr.deathD),
    ppOnSpikePct: rate(c.ppOnSpike, c.ppDeaths), ppSpikeD: med(arr.ppSpikeD),
    castsPr: rate(c.casts, c.castRounds),
  };
}
export const slim = (s) => { const { c, arr, ...rest } = s; return rest; };

const clockOf = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
export function standoutRounds(a, pz, max = 4) {
  const p = a.players[pz], out = [];
  for (const r of a.rounds) {
    const ks = a.kills.filter((k) => k.round === r.n && k.killer === pz);
    if (!ks.length) continue;
    const why = [];
    let score = ks.length;
    const first = ks.find((k) => k.first);
    if (first) { why.push(`opening kill at ${clockOf(first.t)}${first.kCall ? ` (${first.kCall})` : ''}`); score += 2; }
    if (ks.length >= 2) why.push(`${ks.length} kills`);
    const trades = ks.filter((k) => k.tradeKill).length;
    if (trades) { why.push(trades > 1 ? `${trades} trades for teammates` : 'traded a teammate'); score += trades; }
    const clutch = ks.filter((k) => k.aliveBefore.killerTeam === 1);
    if (clutch.length && r.winner === p.team) { why.push(`won the 1v${Math.max(...clutch.map((k) => k.aliveBefore.victimTeam))}`); score += 3; }
    if (!first && ks.length < 2 && !trades) continue;
    out.push({ round: r.n, why: why.join(', '), score });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, max).sort((x, y) => x.round - y.round);
}
// what a player did better than me in one match (only lines where they were clearly better)
export function povDiff(a, me, pz) {
  const S = playerStats([{ a, puuid: pz }]), Me = playerStats([{ a, puuid: me }]), out = [];
  const s = (v) => `${Math.round(v / 1000)} s`;
  if (S.medianContactT != null && Me.medianContactT != null && Me.medianContactT - S.medianContactT >= 4000)
    out.push(`Took their first fight of the round at ${s(S.medianContactT)}, you at ${s(Me.medianContactT)}`);
  const sc = a.players[pz].casts / a.nRounds, mc = a.players[me].casts / a.nRounds;
  if (sc >= mc * 1.2 && sc - mc >= 0.3) out.push(`Used ${sc.toFixed(1)} abilities per round, you ${mc.toFixed(1)}`);
  if (S.c.fk - S.c.fd > Me.c.fk - Me.c.fd && S.c.fk >= 2) out.push(`Opening duels ${S.c.fk}–${S.c.fd}, yours ${Me.c.fk}–${Me.c.fd}`);
  if (S.c.tradeKills >= 2 && S.c.tradeKills > Me.c.tradeKills) out.push(`Traded a teammate ${S.c.tradeKills}×, you ${Me.c.tradeKills}×`);
  if (S.deaths >= 3 && S.tradedPct != null && Me.tradedPct != null && S.tradedPct - Me.tradedPct >= 0.2) out.push(`${S.c.tradedDeaths} of ${S.deaths} deaths traded, yours ${Me.c.tradedDeaths} of ${Me.deaths}`);
  if (S.kills >= 5 && S.oneTapPct != null && Me.oneTapPct != null && S.oneTapPct - Me.oneTapPct >= 0.15) out.push(`${S.c.oneTaps} of ${S.kills} kills with one bullet, yours ${Me.c.oneTaps} of ${Me.kills}`);
  if (S.c.multi > Me.c.multi && S.c.multi >= 3) out.push(`${S.c.multi} rounds with 2+ kills, you ${Me.c.multi}`);
  return out;
}
// the player to watch in one match: the best on my role (else the best in the lobby), when better than me
export function standoutOf(a, me) {
  const m = a.players[me];
  if (!m) return null;
  const others = Object.entries(a.players).filter(([pz]) => pz !== me);
  const pick = (list) => list.sort((x, y) => y[1].score - x[1].score)[0];
  let best = pick(others.filter(([, p]) => p.role === m.role));
  if (!best || best[1].score <= m.score) best = pick(others);
  if (!best || best[1].score <= m.score) return null;
  const [pz, p] = best, acs = (x) => Math.round(x.score / Math.max(1, a.nRounds));
  return { puuid: pz, name: p.name, tag: p.tag, agent: p.agent, agentId: p.agentId, role: p.role, sameRole: p.role === m.role, tier: p.tierName, team: p.team === m.team ? 'your team' : 'enemy team',
    acs: acs(p), myAcs: acs(m), kda: `${p.k}/${p.d}/${p.a}`, rounds: standoutRounds(a, pz), better: povDiff(a, me, pz) };
}

// kind: 'p' = share (x of n), 'r' = per round, 'm' = median of a list (compared on the means)
// good: 1 higher is better, -1 lower is better, 0 depends on the role / situation; group: where it shows on the page
export const STATS = [
  { key: 'kpr', label: 'Kills per round', kind: 'r', x: 'kills', good: 1, fmt: 'dec', group: 'impact' },
  { key: 'dpr', label: 'Deaths per round', kind: 'r', x: 'deaths', good: -1, fmt: 'dec', group: 'impact' },
  { key: 'adr', label: 'Damage per round', kind: 'r', x: 'dmg', good: 1, fmt: 'int', group: 'impact' },
  { key: 'kast', label: 'KAST', kind: 'p', x: 'kast', n: 'rounds', good: 1, fmt: 'pct', group: 'impact', tip: 'Rounds with a kill, an assist, survived or traded.' },
  { key: 'survival', label: 'Rounds survived', kind: 'p', x: 'survived', n: 'rounds', good: 0, fmt: 'pct', group: 'impact' },
  { key: 'multiPct', label: 'Rounds with 2+ kills', kind: 'p', x: 'multi', n: 'rounds', good: 1, fmt: 'pct', group: 'impact' },
  { key: 'fkpr', label: 'Opening kills per round', kind: 'p', x: 'fk', n: 'rounds', good: 0, fmt: 'pct', group: 'opening', tip: 'Share of rounds with the first kill.' },
  { key: 'fdpr', label: 'Opening deaths per round', kind: 'p', x: 'fd', n: 'rounds', good: -1, fmt: 'pct', group: 'opening', tip: 'Share of rounds dying first.' },
  { key: 'openingWin', label: 'Opening duels won', kind: 'p', x: 'fk', n: (c) => c.fk + c.fd, good: 1, fmt: 'pct', group: 'opening' },
  { key: 'fdTradedPct', label: 'Opening deaths traded', kind: 'p', x: 'fdTraded', n: 'fd', good: 1, fmt: 'pct', group: 'opening', tip: 'After dying first, a teammate killed the killer within 5 s.' },
  { key: 'medianContactT', label: 'Time of first fight', kind: 'm', arr: 'contactT', good: 0, fmt: 's', group: 'opening', tip: 'Median round time of the first kill or death in a round.' },
  { key: 'tradedPct', label: 'Deaths traded', kind: 'p', x: 'tradedDeaths', n: 'deaths', good: 1, fmt: 'pct', group: 'team' },
  { key: 'tradeKillPct', label: 'Kills that were trades', kind: 'p', x: 'tradeKills', n: 'kills', good: 0, fmt: 'pct', group: 'team' },
  { key: 'isolatedPct', label: 'Isolated deaths', kind: 'p', x: 'isolated', n: 'deathsWithMates', good: -1, fmt: 'pct', group: 'team', tip: 'Nearest living teammate more than 15 m away.' },
  { key: 'medianIso', label: 'Nearest teammate at death', kind: 'm', arr: 'iso', good: 0, fmt: 'm', group: 'team' },
  { key: 'upDeathsPr', label: 'Deaths while up 2+', kind: 'p', x: 'upDeaths', n: 'rounds', good: -1, fmt: 'pct', group: 'team', tip: 'Per round: died while the team had 2+ more players alive.' },
  { key: 'earlyDeathPct', label: 'Deaths in the first 20 s', kind: 'p', x: 'earlyDeaths', n: 'deaths', good: 0, fmt: 'pct', group: 'positioning' },
  { key: 'medianDeathT', label: 'Typical time of death', kind: 'm', arr: 'deathT', good: 0, fmt: 's', group: 'positioning' },
  { key: 'spaceAtKill', label: 'How far forward kills happen', kind: 'm', arr: 'killSpace', good: 0, fmt: 'idx', group: 'positioning', tip: '0 = own spawn, 100 = enemy spawn.' },
  { key: 'spaceAtDeath', label: 'How far forward deaths happen', kind: 'm', arr: 'deathSpace', good: 0, fmt: 'idx', group: 'positioning', tip: '0 = own spawn, 100 = enemy spawn.' },
  { key: 'ppOnSpikePct', label: 'Post-plant deaths on the spike', kind: 'p', x: 'ppOnSpike', n: 'ppDeaths', good: -1, fmt: 'pct', group: 'positioning', tip: 'Attack, after the plant: died within 12 m of the spike.' },
  { key: 'oneTapPct', label: 'One-bullet kills', kind: 'p', x: 'oneTaps', n: 'kills', good: 1, fmt: 'pct', group: 'aim', tip: 'The only hit on the victim that round was one headshot.' },
  { key: 'killHsPct', label: 'Headshot share on kills', kind: 'p', x: 'head', n: 'hitsAll', good: 1, fmt: 'pct', group: 'aim' },
  { key: 'medianKillD', label: 'Kill distance', kind: 'm', arr: 'killD', good: 0, fmt: 'm', group: 'aim' },
  { key: 'medianDeathD', label: 'Death distance', kind: 'm', arr: 'deathD', good: 0, fmt: 'm', group: 'aim' },
  { key: 'castsPr', label: 'Abilities used per round', kind: 'r', x: 'casts', nKey: 'castRounds', good: 0, fmt: 'dec', group: 'utility', tip: 'Basic abilities (no ultimates), whole matches.' },
];
const SELECTED = new Set(['kpr', 'adr', 'kast', 'multiPct', 'dpr', 'survival', 'fkpr', 'openingWin']);
const OUTCOME = new Set(['kpr', 'dpr', 'adr', 'kast', 'multiPct', 'survival']);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
// how surprising the difference is (≈ standard errors apart); 0 when a side has too little data
function zScore(st, A, B) {
  if (st.kind === 'm') {
    const a = A.arr[st.arr].filter((x) => x != null), b = B.arr[st.arr].filter((x) => x != null);
    if (a.length < 15 || b.length < 15) return 0;
    const se = Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length);
    return se ? (mean(a) - mean(b)) / se : 0;
  }
  const n = (S) => (typeof st.n === 'function' ? st.n(S.c) : S.c[st.n || st.nKey || 'rounds']);
  const na = n(A), nb = n(B);
  if (na < 20 || nb < 20) return 0;
  const pa = A.c[st.x] / na, pb = B.c[st.x] / nb;
  if (st.kind === 'p') {
    const p = (A.c[st.x] + B.c[st.x]) / (na + nb);
    const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
    return se ? (pa - pb) / se : 0;
  }
  if (st.x === 'dmg') return (pa - pb) / Math.sqrt(80 ** 2 / na + 80 ** 2 / nb);
  const se = Math.sqrt(pa / na + pb / nb);
  return se ? (pa - pb) / se : 0;
}
export function compareStats(A, B) {   // A = them, B = you
  return STATS.map((st) => {
    const a = A[st.key], b = B[st.key];
    const z = a == null || b == null ? 0 : zScore(st, A, B);
    return { key: st.key, label: st.label, tip: st.tip || null, fmt: st.fmt, good: st.good, group: st.group, them: a, you: b, z: Math.round(z * 10) / 10 };
  });
}
export { SELECTED, OUTCOME };

const inc = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
export function deathContext(entries, side = '') {
  const lobbySpot = new Map(), lobbyTot = new Map(), mySpot = new Map(), myTot = new Map();
  for (const { a, puuid } of entries) for (const k of a.kills) {
    if (!k.vCall || (side && k.vSide !== side)) continue;
    const key = `${a.map}|${k.vSide}|${k.vCall}`, tot = `${a.map}|${k.vSide}`;
    if (k.victim === puuid) { inc(mySpot, key); inc(myTot, tot); } else { inc(lobbySpot, key); inc(lobbyTot, tot); }
  }
  const common = new Set();
  for (const tot of lobbyTot.keys()) {
    const rows = [...lobbySpot].filter(([k]) => k.startsWith(tot + '|')).sort((x, y) => y[1] - x[1]);
    let acc = 0;
    for (const [k, n] of rows) { if (acc / lobbyTot.get(tot) >= T.commonSpots) break; common.add(k); acc += n; }
  }
  return { lobbySpot, lobbyTot, mySpot, myTot, common };
}
const shareOf = (spot, tot, key, t) => (tot.get(t) ? (spot.get(key) || 0) / tot.get(t) : null);
function overRep(k, n, ls) {
  if (k < 4 || !n || ls == null) return false;
  const ms = k / n, p0 = Math.max(ls, 0.01);
  return ms >= ls * T.mySpotRatio && (ms - p0) / Math.sqrt((p0 * (1 - p0)) / n) >= 2;
}
export function classifyDeaths(points, ctx) {
  for (const p of points) {
    if (p.kind !== 'death' || !p.call) continue;
    const key = `${p.map}|${p.side}|${p.call}`, tot = `${p.map}|${p.side}`;
    const ls = shareOf(ctx.lobbySpot, ctx.lobbyTot, key, tot), why = [];
    if (!p.traded && p.mates && p.iso > T.isolatedFlagM && p.side === 'attack' && !p.postPlant) why.push('alone');
    if (p.up >= T.upPlayers) why.push('up');
    if (p.first && !p.traded) why.push('entry');
    if (p.look && p.look.off > T.lookAwayDeg && !p.back) why.push('away');
    if (overRep(ctx.mySpot.get(key) || 0, ctx.myTot.get(tot) || 0, ls)) why.push('my-spot');
    if (ls != null && ls < T.rareSpot && !p.traded) why.push('rare');
    p.why = why;
    p.cls = why.length ? 'look' : ctx.common.has(key) ? 'expected' : 'normal';
  }
  return points;
}
export function spotTable(ctx, byCallout) {
  const spotRows = new Map();
  for (const [k, n] of ctx.mySpot) { const [map, , call] = k.split('|'); const e = spotRows.get(map + '|' + call) || { map, call, deaths: 0, lobby: 0 }; e.deaths += n; spotRows.set(map + '|' + call, e); }
  for (const [k, n] of ctx.lobbySpot) { const [map, , call] = k.split('|'); const e = spotRows.get(map + '|' + call); if (e) e.lobby += n; }
  const totOf = (m, map) => [...m].filter(([k]) => k.startsWith(map + '|')).reduce((s2, [, n]) => s2 + n, 0);
  return [...spotRows.values()].map((e) => {
    const d = byCallout.get(`${e.map} · ${e.call}`) || { won: 0, lost: 0 };
    const mt = totOf(ctx.myTot, e.map), lt = totOf(ctx.lobbyTot, e.map);
    const my = mt ? e.deaths / mt : 0, lob = lt ? e.lobby / lt : 0;
    return { map: e.map, call: e.call, won: d.won, lost: d.lost, n: d.won + d.lost, winPct: d.won + d.lost ? d.won / (d.won + d.lost) : null,
      deaths: e.deaths, myShare: r3(my), lobbyShare: r3(lob), over: overRep(e.deaths, mt, lob) };
  }).sort((x, y) => y.deaths - x.deaths);
}

export function createInsights(store) {
  const mem = new Map();
  const MEM_MAX = 400;
  const remember = (id, a) => { mem.set(id, a); if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); };

  async function analysed(matchId) {
    if (mem.has(matchId)) return mem.get(matchId);
    const file = path.join(ANALYSIS_DIR, matchId + '.json');
    try { const a = JSON.parse(fs.readFileSync(file, 'utf8')); if (a.v === VERSION) { remember(matchId, a); return a; } } catch {}
    const raw = store.cachedMatch(matchId);
    if (!raw || !raw.rounds) return null;
    const map = await assets.mapByName(raw.metadata && raw.metadata.map && raw.metadata.map.name).catch(() => null);
    // an agent the cached list doesn't know yet (a new agent): roleOf refreshes the list once
    for (const p of raw.players || []) if (p.agent && p.agent.id) await assets.roleOf(p.agent.id.toLowerCase()).catch(() => null);
    const roles = await assets.roles().catch(() => new Map());
    const a = analyseMatch(raw, map, roles);
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    writeFileAtomic(file, JSON.stringify(a));
    remember(matchId, a);
    return a;
  }

  async function entriesOf(records, { days = 0, map = '', role = '' } = {}) {
    const since = days ? Date.now() - days * 86400000 : 0;
    const out = [], seen = new Set();
    for (const r of records) {
      if (Date.parse(r.date) < since || (map && String(r.map).toLowerCase() !== map.toLowerCase())) continue;
      if (seen.has(r.match_id + r.puuid)) continue;
      seen.add(r.match_id + r.puuid);
      const a = await analysed(r.match_id);
      if (!a || !a.players[r.puuid]) continue;
      if (role && a.players[r.puuid].role !== role) continue;
      out.push({ a, puuid: r.puuid });
    }
    return out;
  }

  function pointsOf(entries, side = '') {
    const points = [];
    for (const { a, puuid } of entries) for (const k of a.kills) {
      const isKill = k.killer === puuid, isDeath = k.victim === puuid;
      if (!isKill && !isDeath) continue;
      const s = isKill ? k.kSide : k.vSide;
      if (side && s !== side) continue;
      const uv = isKill ? k.kUV : k.vUV;
      points.push({ kind: isKill ? 'kill' : 'death', u: uv && uv.u, v: uv && uv.v, map: a.map, side: s, call: isKill ? k.kCall : k.vCall, t: k.t,
        weapon: isKill ? k.weapon : k.vWeapon, opp: isKill ? (a.players[k.victim] || {}).name : (a.players[k.killer] || {}).name,
        round: k.round, match: a.match_id, puuid, date: a.date, traded: k.traded, first: k.first, postPlant: k.postPlant,
        iso: k.iso, mates: k.matesAlive, up: k.aliveBefore ? k.aliveBefore.victimTeam - k.aliveBefore.killerTeam : 0,
        d: k.d, back: k.back, look: k.look, kU: isDeath && k.kUV ? k.kUV.u : null, kV: isDeath && k.kUV ? k.kUV.v : null });
    }
    return points;
  }
  async function mapInfos(names) {
    const out = {};
    for (const m of names) { const g = await assets.mapByName(m).catch(() => null); if (g) out[m] = M.mapInfo(g); }
    return out;
  }

  async function build({ scope = 'default', map = '', side = '', days = 0, role = '' } = {}) {
    const records = store.myRecords(scope);
    const allEnts = await entriesOf(records, { days, map });
    // no role picked: your most played one, as in compare(), so both halves of the page cover the same games
    const roleN = {};
    for (const { a, puuid: pz } of allEnts) { const r = a.players[pz].role; if (r) roleN[r] = (roleN[r] || 0) + 1; }
    const useRole = role && role !== 'all' ? role : role === 'all' ? '' : Object.entries(roleN).sort((x, y) => y[1] - x[1]).map(([r]) => r)[0] || '';
    const ents = useRole ? allEnts.filter(({ a, puuid: pz }) => a.players[pz].role === useRole) : allEnts;
    const inRange = records.filter((r) => (!days || Date.parse(r.date) >= Date.now() - days * 86400000) && (!map || String(r.map).toLowerCase() === map.toLowerCase()));
    const coverage = { analysed: ents.length, matches: inRange.length, backfill: store.backfill() };
    const sideOk = (s) => !side || s === side;

    const byCallout = new Map(), byWeapon = new Map(), byDist = new Map();
    const bump = (m, key, won) => { if (!key) return; const e = m.get(key) || { key, won: 0, lost: 0 }; won ? e.won++ : e.lost++; m.set(key, e); };
    const scenarios = [];
    for (const { a, puuid: pz } of ents) {
      const me = a.players[pz];
      for (const k of a.kills) {
        const isKill = k.killer === pz, isDeath = k.victim === pz;
        if (!isKill && !isDeath) continue;
        const mySide = isKill ? k.kSide : k.vSide;
        if (!sideOk(mySide)) continue;
        const call = isKill ? k.kCall : k.vCall;
        bump(byCallout, call && `${a.map} · ${call}`, isKill);
        bump(byWeapon, isKill ? k.weapon : k.vWeapon, isKill);
        bump(byDist, band(k.d), isKill);
        if (!isDeath) continue;
        const round = a.rounds[k.round - 1], base = { match: a.match_id, puuid: pz, map: a.map, agent: me.agent, agentId: me.agentId, date: a.date, round: k.round, t: k.t, call };
        const attacking = mySide === 'attack';
        if (attacking && round.plant && round.plant.t < T.earlyPlantMs && k.postPlant && k.spikeD != null && k.spikeD < T.onSpikeM && round.winner !== me.team)
          scenarios.push({ ...base, key: 'plant-on-site', text: `Plant at ${Math.round(round.plant.t / 1000)} s, then you died ${k.spikeD.toFixed(0)} m from the spike (${call}) and lost the round. Off-site, or taking space instead of sitting on it?` });
        if ((me.role === 'Controller' || me.role === 'Sentinel') && k.t < T.roleEarlyMs)
          scenarios.push({ ...base, key: 'role-early', text: `${me.role} (${me.agent}) dead after ${Math.round(k.t / 1000)} s at ${call}: the team played the rest of the round without your utility.` });
        if (attacking && !k.postPlant && k.matesAlive && k.iso > T.isolatedFlagM && !k.traded)
          scenarios.push({ ...base, key: 'isolated', text: `Attacking before the plant, died at ${call} with the nearest teammate ${Math.round(k.iso)} m away: nobody could trade.` });
        const up = k.aliveBefore.victimTeam - k.aliveBefore.killerTeam;
        if (up >= T.upPlayers) scenarios.push({ ...base, key: 'up-players', text: `Died ${k.aliveBefore.victimTeam} v ${k.aliveBefore.killerTeam} at ${call}: your team was up ${up}.` });
        if (me.role === 'Duelist' && attacking && k.first && !k.traded)
          scenarios.push({ ...base, key: 'entry-untraded', text: `Opening duel lost at ${call} and not traded${k.iso != null ? ` (nearest teammate ${Math.round(k.iso)} m)` : ''}: was the entry tradeable?` });
      }
    }
    const ctx = deathContext(ents, side);
    const points = classifyDeaths(pointsOf(ents, side), ctx);
    const spots = spotTable(ctx, byCallout);
    const byRound = new Map();
    for (const sc of scenarios) {
      const k = sc.match + '|' + sc.round, e = byRound.get(k);
      if (!e) byRound.set(k, { ...sc, keys: [sc.key], texts: [sc.text] });
      else if (!e.keys.includes(sc.key)) { e.keys.push(sc.key); e.texts.push(sc.text); }
    }
    const ranked = [...byRound.values()].map((e) => {
      const age = (Date.now() - Date.parse(e.date)) / 86400000;
      const score = e.keys.reduce((s2, k) => s2 + (SEVERITY[k] || 1), 0) + (age < 14 ? 2 : age < 60 ? 1 : 0);
      return { ...e, key: e.keys.slice().sort((x, y) => (SEVERITY[y] || 1) - (SEVERITY[x] || 1))[0], score };
    }).sort((a, b) => b.score - a.score || Date.parse(b.date) - Date.parse(a.date) || a.round - b.round);

    // counts for the filters, over every role
    const roleCount = {}, agentCount = {}, mapCount = {};
    for (const { a, puuid: pz } of allEnts) {
      const p = a.players[pz];
      if (p.role) roleCount[p.role] = (roleCount[p.role] || 0) + 1;
      const won = a.rounds.filter((r) => r.winner === p.team).length > a.rounds.filter((r) => r.winner && r.winner !== p.team).length;
      if (p.agent) { const e = agentCount[p.agent] || (agentCount[p.agent] = { n: 0, id: p.agentId, won: 0 }); e.n++; if (won) e.won++; }
      const m = mapCount[a.map] || (mapCount[a.map] = { n: 0, won: 0 }); m.n++; if (won) m.won++;
    }
    const sortDuels = (m) => [...m.values()].map((e) => ({ ...e, n: e.won + e.lost, winPct: e.won / (e.won + e.lost) })).sort((x, y) => y.n - x.n);
    return {
      role: useRole, coverage, maps: await mapInfos([...new Set(ents.map((e) => e.a.map))]),
      overall: slim(playerStats(ents, side)), roleCount, agentCount, mapCount,
      points, spots, byCallout: sortDuels(byCallout), byWeapon: sortDuels(byWeapon),
      byDistance: sortDuels(byDist).sort((x, y) => BANDS.indexOf(x.key) - BANDS.indexOf(y.key)),
      scenarios: ranked.slice(0, 60),
    };
  }

  // the standout of each of my matches: the other player on my role with the highest combat score, when it beat mine
  function standoutsIn(myEntries, role) {
    const out = [];
    for (const { a, puuid } of myEntries) {
      const me = a.players[puuid], acs = (p) => p.score / Math.max(1, a.nRounds);
      const cands = Object.entries(a.players).filter(([pz, p]) => pz !== puuid && p.role === (role || me.role));
      if (!cands.length) continue;
      const [pz, p] = cands.sort((x, y) => y[1].score - x[1].score)[0];
      if (acs(p) <= acs(me)) continue;
      out.push({ entry: { a, puuid: pz }, info: { match: a.match_id, me: puuid, map: a.map, date: a.date, name: p.name, tag: p.tag, agent: p.agent, agentId: p.agentId, role: p.role, tier: p.tierName,
        acs: Math.round(acs(p)), myAcs: Math.round(acs(me)), kd: `${p.k}/${p.d}/${p.a}`, sameTeam: p.team === me.team,
        rounds: standoutRounds(a, pz, 3), better: povDiff(a, puuid, pz) } });
    }
    return out;
  }

  // target: 'lobby' (your role in your lobbies), 'standouts' or a pro id
  async function compare({ scope = 'default', target = 'lobby', role = '', side = '', days = 0, map = '' } = {}) {
    const allMine = await entriesOf(store.myRecords(scope), { days, map });
    const roleCount = {};
    for (const { a, puuid: pz } of allMine) { const r = a.players[pz].role; if (r) roleCount[r] = (roleCount[r] || 0) + 1; }
    // without a role picked: your most played one (a controller's numbers next to a duelist's say little)
    const useRole = role === 'all' ? '' : role || Object.entries(roleCount).sort((x, y) => y[1] - x[1]).map(([r]) => r)[0] || '';
    const mine = useRole ? allMine.filter(({ a, puuid: pz }) => a.players[pz].role === useRole) : allMine;
    let theirs = [], standouts = null, who = null, coverage = null;
    if (target === 'lobby') {
      for (const { a, puuid: me } of mine) for (const [pz, p] of Object.entries(a.players)) if (pz !== me && p.role === a.players[me].role) theirs.push({ a, puuid: pz });
      who = { name: `Other ${useRole ? useRole.toLowerCase() + 's' : 'players'} in your lobbies`, short: 'Your lobbies', kind: 'lobby' };
    } else if (target === 'standouts') {
      const s = standoutsIn(mine, useRole);
      theirs = s.map((x) => x.entry);
      standouts = s.map((x) => x.info).sort((x, y) => Date.parse(y.date) - Date.parse(x.date)).slice(0, 30);
      who = { name: `Best ${useRole ? useRole.toLowerCase() : 'player'} in each of your lobbies`, short: 'Standouts', kind: 'standouts' };
    } else {
      const pro = store.pros().find((p) => p.id === target);
      if (!pro) throw new Error('Unknown pro');
      const recs = store.proRecords(target);
      theirs = await entriesOf(recs, { role: useRole, map });
      const all = await entriesOf(recs, { map });
      const agents = {};
      for (const { a, puuid: pz } of all) { const g = a.players[pz].agent; agents[g] = (agents[g] || 0) + 1; }
      who = { name: pro.name, short: pro.name, kind: 'pro', agents };
      coverage = { analysed: all.length, matches: recs.length };
    }
    const A = playerStats(theirs, side), B = playerStats(mine, side);
    const rows = compareStats(A, B);
    if (target === 'standouts') for (const r of rows) if (SELECTED.has(r.key)) r.selected = true;
    const maps = [...new Set([...theirs, ...mine].map((e) => e.a.map))];
    return {
      who, role: useRole, side, roleCount, coverage, standouts,
      sample: { them: { matches: new Set(theirs.map((e) => e.a.match_id)).size, players: theirs.length, rounds: A.rounds }, you: { matches: mine.length, rounds: B.rounds } },
      rows, jumps: rows.filter((r) => !r.selected && !OUTCOME.has(r.key) && Math.abs(r.z) >= 2).sort((x, y) => Math.abs(y.z) - Math.abs(x.z)).slice(0, 8),
      phases: { them: A.byPhase, you: B.byPhase, labels: PHASES }, bands: { them: A.byBand, you: B.byBand, labels: BANDS },
      maps: await mapInfos(maps),
      // the benchmark's deaths for the side-by-side map (a lobby has thousands: left out, the pros' and standouts' are shown)
      points: target === 'lobby' ? [] : classifyDeaths(pointsOf(theirs, side), deathContext(theirs, side)).slice(0, 3000),
    };
  }

  // ultimates per 20 rounds, per agent, in your lobbies (Quick analysis)
  let ultCache = null;
  async function lobbyUltRates() {
    if (ultCache && Date.now() - ultCache.at < 600000) return ultCache.rates;
    const ents = await entriesOf(store.myRecords('all').slice(0, 150));
    const rates = {};
    for (const { a, puuid } of ents) for (const [pz, p] of Object.entries(a.players)) {
      if (pz === puuid || !p.agent) continue;
      const x = rates[p.agent] || (rates[p.agent] = { ult: 0, rounds: 0, players: 0 });
      x.ult += p.ult || 0; x.rounds += a.nRounds; x.players++;
    }
    for (const x of Object.values(rates)) x.per20 = x.rounds ? (x.ult / x.rounds) * 20 : null;
    ultCache = { at: Date.now(), rates };
    return rates;
  }

  return { analysed, build, compare, lobbyUltRates };
}
