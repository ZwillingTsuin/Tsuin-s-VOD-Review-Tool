// Rounds worth studying in a streamer's VODs. VOD second = (match start + round start − VOD start) / 1000 + delay.
// Scores compare within one kind:
//   clutch     the team is down to them and they win it. 1v1s won without a kill (time ran out) are left out.
//   retake     defense, spike down, they get kills after the plant and the round is won; more when they were down players
//   postplant  attack, they hold the planted spike and get kills doing it
//   hit        attack, a won site take where they got a kill before the plant; more for the entry (first kill)
//   opening    they take the first duel of the round and the round is won: how they find first contact
//   hold       defense, no plant or before it: they stop the attack with 2+ kills from their spot
//   game       the whole game, from the first round
const DAY = 86400000;
const TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'];
const tierLabel = (t) => { const r = Math.round(t); return r >= 27 ? 'Radiant' : r < 3 ? 'unranked' : `${TIERS[Math.floor((r - 3) / 3)]} ${((r - 3) % 3) + 1}`; };
export const KINDS = ['clutch', 'retake', 'postplant', 'hit', 'opening', 'hold', 'game'];
const clockOf = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

// vods: [{ id, start, dur }]; records: [{ match_id, puuid, date }]; kinds: only these (all when null)
export async function findPlays({ player, channel = null, vods, delay = 0, retention = 60, records, kinds = null, cachedMatch, analysed, roundStarts }) {
  const vs = (vods || []).map((v) => ({ id: String(v.id), s: Date.parse(v.start), e: Date.parse(v.start) + Number(v.dur || 0) * 1000 }))
    .filter((v) => v.id && Number.isFinite(v.s) && v.e > v.s);
  const plays = [];
  for (const rec of records) {
    const t0 = Date.parse(rec.date);
    if (!vs.some((v) => t0 + delay * 1000 < v.e && t0 + 90 * 60000 > v.s)) continue;   // cheap check before reading the match
    const raw = cachedMatch(rec.match_id);
    if (!raw || !raw.metadata) continue;
    const len = raw.metadata.game_length_in_ms || 0;
    const vod = vs.find((v) => t0 + delay * 1000 < v.e && t0 + len + delay * 1000 > v.s);
    if (!vod) continue;
    const a = await analysed(rec.match_id);
    if (!a || !a.players || !a.players[rec.puuid]) continue;
    const me = a.players[rec.puuid], team = me.team, pz = rec.puuid;
    const vodLen = (vod.e - vod.s) / 1000;
    const at = (matchMs) => Math.round((t0 + matchMs - vod.s) / 1000 + delay);   // seconds into the VOD
    const inVod = (s) => s >= 5 && s <= vodLen - 30;
    const starts = roundStarts(raw);
    const teams = {}; for (const [id, p] of Object.entries(a.players)) (teams[p.team] ||= new Set()).add(id);
    const duelist = me.role === 'Duelist' ? 1 : 0;
    const base = { player, channel, vod_id: vod.id, vod_start: new Date(vod.s).toISOString(), expires: new Date(vod.s + retention * DAY).toISOString().slice(0, 10),
      match_id: rec.match_id, puuid: pz, map: a.map, agent: me.agent, agent_id: me.agentId || null, role: me.role || null };
    const add = (p) => { if (inVod(p.t) && (!kinds || kinds.includes(p.kind))) plays.push({ ...base, ...p }); };
    const s = (n) => `${n} kill${n === 1 ? '' : 's'}`;

    for (const rd of a.rounds) {
      const rs = starts[rd.n - 1];
      if (rs == null) continue;
      const rawR = (raw.rounds || [])[rd.n - 1] || {};
      const ks = a.kills.filter((k) => k.round === rd.n).sort((p, q) => p.t - q.t);
      const won = rd.winner === team, attack = rd.atk === team, side = attack ? 'attack' : 'defense';
      const mine = ks.filter((k) => k.killer === pz), death = ks.find((k) => k.victim === pz);
      const r = { round: rd.n, side };
      const plant = rd.plant;
      const beforePlant = (k) => !plant || k.t <= plant.t;

      const alive = {}; for (const t in teams) alive[t] = new Set(teams[t]);
      let clutch = null;
      for (const k of ks) {
        if (!alive[k.vTeam] || !alive[k.vTeam].has(k.victim)) continue;
        alive[k.vTeam].delete(k.victim);
        if (!clutch && alive[team] && alive[team].size === 1 && alive[team].has(pz)) {
          const other = Object.keys(alive).find((x) => x !== team);
          if (other && alive[other].size >= 1) clutch = { x: alive[other].size, t: k.t };
        }
      }
      if (clutch && won && clutch.x <= 5) {
        const n = mine.filter((k) => k.t >= clutch.t).length;
        const defused = rawR.result === 'Defuse' && !attack;
        if (n >= 1 || defused) {
          add({ ...r, kind: 'clutch', t: at(rs + clutch.t) - 8, score: clutch.x * 10 + n * 4 + duelist * 3 + (defused ? 3 : 0),
            label: `1v${clutch.x} won${defused ? ' with the defuse' : rawR.result === 'Detonate' ? ', spike exploded' : ''} (${s(n)} in the clutch)` });
        }
      }
      if (plant && won && (!death || death.t > plant.t)) {
        const after = mine.filter((k) => k.t > plant.t).length;
        const aliveAt = (set) => [...set].filter((id) => !ks.some((k) => k.victim === id && k.t <= plant.t)).length;
        const us = aliveAt(teams[team] || new Set()), them = aliveAt(Object.values(teams).find((x) => !x.has(pz)) || new Set());
        if (!attack && after >= 1) {
          add({ ...r, site: plant.site, kind: 'retake', t: at(rs + plant.t) - 10, score: after * 6 + Math.max(0, them - us) * 6 + (rawR.result === 'Defuse' ? 4 : 0) + duelist * 2,
            label: `Retake ${plant.site}: spike down at ${Math.round(plant.t / 1000)} s (${us}v${them}), ${s(after)}${rawR.result === 'Defuse' ? ', defused' : ''}` });
        }
        if (attack && after >= 1) {
          add({ ...r, site: plant.site, kind: 'postplant', t: at(rs + plant.t) - 8, score: after * 6 + Math.max(0, them - us) * 6 + duelist,
            label: `Post-plant ${plant.site} (${us}v${them}), ${s(after)} holding it` });
        }
      }
      if (attack && won && plant) {
        const entry = mine.filter((k) => k.t <= plant.t);
        const first = entry.find((k) => k.first);
        if (entry.length >= 1) add({ ...r, site: plant.site, kind: 'hit', t: at(rs) - 12, score: entry.length * 6 + (first ? 8 : 0) + duelist * 4 + (death ? 0 : 3),
          label: `${plant.site} take: ${first ? 'entry kill, ' : ''}${s(entry.length)} before the plant at ${Math.round(plant.t / 1000)} s${death ? '' : ', survived'}` });
      }
      const firstKill = ks.find((k) => k.first);
      if (firstKill && firstKill.killer === pz && won) {
        const where = firstKill.kCall ? ` from ${firstKill.kCall}` : '';
        add({ ...r, kind: 'opening', t: at(rs + firstKill.t) - 12, score: 10 + duelist * 6 + (mine.length >= 2 ? 4 : 0) + (firstKill.t < 25000 ? 3 : 0) + (firstKill.oneTap ? 2 : 0),
          label: `Opening kill ${side === 'attack' ? 'on attack' : 'on defense'} at ${clockOf(firstKill.t)}${where} (${firstKill.weapon || 'weapon'}), round won` });
      }
      const held = !attack && won ? mine.filter(beforePlant) : [];
      if (held.length >= 2) {
        const call = held[0].kCall;
        add({ ...r, kind: 'hold', t: at(rs + held[0].t) - 15, score: held.length * 7 + (death ? 0 : 3) + (me.role === 'Sentinel' || me.role === 'Controller' ? 3 : 0),
          label: `Held ${call || 'the site'}: ${s(held.length)} before ${plant ? 'the plant' : 'they could plant'}` });
      }
    }
    // whole games: higher lobbies and close games first
    const tm = (raw.teams || []).find((x) => x.team_id === team) || { rounds: {} };
    const res = tm.won ? 'W' : tm.rounds && tm.rounds.won === tm.rounds.lost ? 'D' : 'L';
    const margin = tm.rounds ? Math.abs((tm.rounds.won || 0) - (tm.rounds.lost || 0)) : 13;
    const tiers = Object.values(a.players).map((p) => p.tier).filter((t) => t > 2);
    const lobby = tiers.length ? tiers.reduce((x, y) => x + y, 0) / tiers.length : 0;
    if (starts[0] != null) add({ round: 0, side: null, kind: 'game', t: at(starts[0]) - 20, score: lobby * 10 + Math.max(0, 8 - margin) + duelist * 2,
      label: `Whole game: ${res} ${tm.rounds ? `${tm.rounds.won}-${tm.rounds.lost}` : ''}, ${me.k}/${me.d}/${me.a}${lobby ? `, lobby ${tierLabel(lobby)}` : ''}` });
  }
  return plays;
}
