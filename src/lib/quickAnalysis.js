// The Quick analysis box on the match page: what went well, what leaked (with rounds), and the lobby's standout.
import { playerStats, standoutOf, T } from './insights.js';

export async function quickAnalysis(insights, { matchId, puuid }) {
  const a = await insights.analysed(matchId);
  if (!a || !a.players[puuid]) return { empty: true };
  const me = a.players[puuid], S = playerStats([{ a, puuid }]);
  const mine = a.kills.filter((k) => k.killer === puuid), deaths = a.kills.filter((k) => k.victim === puuid);
  const rounds = (xs) => [...new Set(xs.map((k) => k.round))];
  const good = [], bad = [];
  const add = (list, weight, text, rs = [], key = null) => list.push({ weight, text, rounds: rs, key });

  const ranked = Object.entries(a.players).sort((x, y) => y[1].score - x[1].score);
  const rank = ranked.findIndex(([pz]) => pz === puuid) + 1;
  const teamRank = ranked.filter(([, p]) => p.team === me.team).findIndex(([pz]) => pz === puuid) + 1;
  if (rank === 1) add(good, 5, 'Top of the lobby by combat score.', [], 'top');
  else if (teamRank === 1) add(good, 4, `Top of your team by combat score (#${rank} in the lobby).`, [], 'top');

  // opening duels
  const fk = mine.filter((k) => k.first), fd = deaths.filter((k) => k.first);
  if (fk.length >= 2 && fk.length > fd.length) add(good, 3 + fk.length, `Opening duels ${fk.length}–${fd.length}: you started rounds on the right foot.`, rounds(fk), 'opening');
  const fdUntraded = fd.filter((k) => !k.traded);
  if (fdUntraded.length >= 2 && fd.length >= fk.length) add(bad, 3 + fdUntraded.length, `Died first ${fd.length}× and ${fdUntraded.length} of them weren't traded: the team played those rounds a player down from the start.`, rounds(fdUntraded), 'opening');

  // trading
  const trades = mine.filter((k) => k.tradeKill);
  if (trades.length >= 2) add(good, 2 + trades.length, `Traded a teammate ${trades.length}×: you were close enough to swing on their fights.`, rounds(trades), 'trade');
  if (S.deaths >= 5 && S.tradedPct >= 0.5) add(good, 3, `${S.c.tradedDeaths} of your ${S.deaths} deaths were traded: you died where the team could punish it.`, [], 'trade');
  const iso = deaths.filter((k) => k.vSide === 'attack' && !k.postPlant && k.matesAlive && k.iso > T.isolatedFlagM && !k.traded);
  if (iso.length >= 2) add(bad, 2 + iso.length, `${iso.length} attack deaths before the plant with nobody within 20 m: nobody could trade them.`, rounds(iso), 'isolated');

  // aim and impact
  if (S.kills >= 6 && S.oneTapPct >= 0.5) add(good, 3, `${S.c.oneTaps} of ${S.kills} kills with a single headshot: the first bullet was on.`, [], 'aim');
  else if (S.kills >= 6 && S.oneTapPct < 0.25) add(bad, 2, `Only ${S.c.oneTaps} of ${S.kills} kills with a single headshot: most duels needed several bullets. Check crosshair height in the VOD.`, [], 'aim');
  const multi = rounds(mine).filter((n) => mine.filter((k) => k.round === n).length >= 2);
  if (multi.length >= 3) add(good, 2 + multi.length, `${multi.length} rounds with 2+ kills.`, multi, 'multi');
  const clutch = a.rounds.filter((r) => r.winner === me.team && mine.some((k) => k.round === r.n && k.aliveBefore.killerTeam === 1)).map((r) => r.n);
  if (clutch.length) add(good, 4, `Won ${clutch.length > 1 ? `${clutch.length} rounds` : 'a round'} as the last one alive.`, clutch, 'clutch');

  // leaks
  const up = deaths.filter((k) => k.aliveBefore.victimTeam - k.aliveBefore.killerTeam >= T.upPlayers);
  if (up.length >= 2) add(bad, 2 + up.length, `Died ${up.length}× while your team was 2+ players up: free picks that gave the advantage back.`, rounds(up), 'advantage');
  const onSpike = deaths.filter((k) => k.postPlant && k.vSide === 'attack' && k.spikeD != null && k.spikeD < T.onSpikeM);
  if (onSpike.length >= 2) add(bad, 2 + onSpike.length, `After the plant you died within 12 m of the spike ${onSpike.length}×: play the post-plant from off-site.`, rounds(onSpike), 'postplant');
  if (me.role === 'Controller' || me.role === 'Sentinel') {
    const early = deaths.filter((k) => k.t < T.roleEarlyMs);
    if (early.length >= 3) add(bad, 2 + early.length, `As ${me.role.toLowerCase()} you died in the first 25 s ${early.length}×: those rounds had no ${me.role === 'Controller' ? 'smokes' : 'flank watch'} after that.`, rounds(early), 'role-early');
  }
  const away = deaths.filter((k) => k.look && k.look.off > T.lookAwayDeg && !k.back);
  if (away.length >= 3) add(bad, 2 + away.length, `${away.length} deaths to someone you weren't looking at, without a shot back: check which angle you left open.`, rounds(away), 'away');

  // tempo and utility against the same role in this match
  const sameRole = Object.keys(a.players).filter((pz) => pz !== puuid && a.players[pz].role === me.role);
  if (sameRole.length) {
    const others = playerStats(sameRole.map((pz) => ({ a, puuid: pz })));
    if ((me.role === 'Duelist' || me.role === 'Initiator') && S.medianContactT != null && others.medianContactT != null && S.medianContactT - others.medianContactT >= 5000)
      add(bad, 3, `Your first fight of a round came at ${Math.round(S.medianContactT / 1000)} s, the other ${me.role.toLowerCase()}s' at ${Math.round(others.medianContactT / 1000)} s: you waited for the fight.`, [], 'tempo');
    const casts = me.casts / a.nRounds, oc = sameRole.reduce((s, pz) => s + a.players[pz].casts, 0) / sameRole.length / a.nRounds;
    if (casts < oc * 0.75 && oc - casts >= 0.4) add(bad, 3, `${casts.toFixed(1)} abilities per round, the other ${me.role.toLowerCase()}s ${oc.toFixed(1)}: more of your fights were dry.`, [], 'utility');
    else if (casts > oc * 1.25 && casts - oc >= 0.4) add(good, 2, `${casts.toFixed(1)} abilities per round, more than the other ${me.role.toLowerCase()}s (${oc.toFixed(1)}).`, [], 'utility');
  }

  // ultimates, against how often this agent's ult gets used in your lobbies
  try {
    const rate = (await insights.lobbyUltRates())[me.agent];
    if (rate && rate.players >= 5 && rate.per20 != null) {
      const expected = (rate.per20 * a.nRounds) / 20, used = me.ult || 0;
      if (expected >= 1.5 && used <= expected * 0.5)
        add(bad, 2 + Math.round(expected - used), `Used your ultimate ${used}× in ${a.nRounds} rounds; ${me.agent} players in your lobbies use it about ${Math.round(expected * 10) / 10}× in a game this long.`, [], 'ult');
    }
  } catch { /* no rate yet */ }

  good.sort((x, y) => y.weight - x.weight); bad.sort((x, y) => y.weight - x.weight);
  const acs = Math.round(me.score / Math.max(1, a.nRounds));
  const headline = `${acs} ACS, #${rank} of ${ranked.length} in the lobby as ${me.agent}. ${bad[0] ? `Biggest leak: ${bad[0].text.replace(/[.:].*$/, '').toLowerCase()}.` : 'Nothing leaked clearly.'}`;
  return { headline, good: good.slice(0, 4), bad: bad.slice(0, 4), standout: standoutOf(a, puuid) };
}
