import { api, pref, setPref } from '../api.js';
import { h, put, help, dateTime, toast, fill, nameTag } from '../ui.js';
import { icon } from '../icons.js';
import { mapArt, agentImg, tierImg, tierName } from '../assets.js';
import { roundView } from '../components/roundView.js';
import { scoreboard } from '../components/scoreboard.js';
import { economySection } from '../components/economy.js';

const PARTY = { 1: 'Solo', 2: 'Duo', 3: '3-stack', 4: '4-stack', 5: '5-stack' };
export const bannerBg = (splash) => `linear-gradient(90deg, rgba(14,14,14,.97) 0%, rgba(14,14,14,.82) 45%, rgba(14,14,14,.45) 100%), url("${splash}")`;

export async function render(root, [matchId, puuid, roundArg]) {
  put(root, h('p', { class: 'muted loading' }, h('i', { class: 'spinner' }), 'Loading the match…'));
  let d;
  try { d = await api.get(`/api/matches/${encodeURIComponent(matchId)}?puuid=${encodeURIComponent(puuid || '')}`); }
  catch (err) { fill(root, backLink(), h('div', { class: 'empty' }, icon('warn', 22), h('h3', {}, 'This match could not load'), h('p', { class: 'muted' }, err.message))); return; }
  fill(root);
  const me = d.players.find((p) => p.isMe);

  const rv = roundView(d);
  const jump = (n) => { rv.open(n); rv.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  put(root, backLink(), banner(d, me, matchId, puuid),
    me ? quickBox(matchId, puuid, jump) : null,
    scoreboard(d),
    h('section', { class: 'card rounds-card' }, h('div', { class: 'sec-head' }, h('h2', {}, 'Rounds'), help('Pick a round for its kill feed and map. Click a kill (or a mark on the map) for the duel: the map zooms onto it and the facts show on the left.')), rv.el),
    economySection(d, { onRound: jump }));
  const startRound = roundArg && /^r\d+$/.test(roundArg) ? Number(roundArg.slice(1)) : null;
  const first = d.rounds.find((r) => r.n === startRound) || d.rounds.find((r) => r.me && r.me.died) || d.rounds[0];
  if (first) rv.open(first.n);
  if (startRound) requestAnimationFrame(() => rv.el.scrollIntoView({ block: 'start' }));
  return () => rv.destroy();
}

const backLink = () => h('a', { class: 'back', href: '#/matches' }, icon('back', 14), 'Matches');

function banner(d, me, matchId, puuid) {
  const art = mapArt(d.map);
  const res = d.won === true ? 'Victory' : d.won === false ? 'Defeat' : 'Draw';
  const s = d.summary || {};
  const party = me && me.party ? d.players.filter((p) => p.team === me.team && p.party === me.party).length : 1;
  const review = d.review;
  const btnLabel = review && review.status === 'done' ? 'Open review' : review ? 'Continue review' : 'VOD review';
  const sub = d.myVod ? 'with your Twitch VOD' : review && review.source === 'file' ? 'with your recording' : review && review.source === 'youtube' ? 'with YouTube' : 'minimap, recording or YouTube';
  const startReview = async (e) => {
    e.currentTarget.disabled = true;
    try { const v = await api.post('/api/reviews', { kind: 'match', match_id: matchId, puuid }); location.hash = `#/review/${v.id}`; }
    catch (err) { toast(err.message, 'bad'); e.currentTarget.disabled = false; }
  };
  const stat = (v, l, tip) => h('div', { class: 'bstat', 'data-tip': tip }, h('b', { class: 'num' }, v), h('small', {}, l));
  const el = h('section', { class: `banner res-${d.won === true ? 'w' : d.won === false ? 'l' : 'd'}` },
    h('div', { class: 'banner-main' },
      h('div', { class: 'banner-meta' },
        h('span', { class: 'res-badge' }, res),
        h('span', {}, dateTime(d.started_at)),
        d.queue ? h('span', {}, d.queue) : null,
        d.account ? h('span', {}, d.account.riotId) : null,
        me ? h('span', { class: 'mtag' }, icon(party > 1 ? 'users' : 'user', 11), PARTY[party] || `${party}-stack`) : null,
        d.avgTier && d.avgTier.all ? h('span', { class: 'row-i' }, 'Lobby ', tierImg(d.avgTier.all, 'tier-xs'), tierName(d.avgTier.all)) : null),
      h('div', { class: 'banner-title' },
        me ? h('span', { 'data-tip': me.agent }, agentImg(me.agentId, 'banner-agent', me.agent)) : null,
        h('div', {}, h('h1', {}, d.map || 'Match', h('span', { class: 'score num' }, `${d.score.us} : ${d.score.them}`)),
          d.rr != null ? h('span', { class: `rr ${d.rr > 0 ? 'up' : d.rr < 0 ? 'down' : ''}`, 'data-tip': 'Rank rating won or lost' }, `${d.rr > 0 ? '+' : ''}${d.rr} RR`) : null)),
      me ? h('div', { class: 'banner-stats' },
        stat(`${me.kills}/${me.deaths}/${me.assists}`, 'K / D / A'), stat(me.acs, 'ACS', 'Average combat score'), stat(me.adr, 'ADR', 'Average damage per round'),
        stat(me.hs != null ? `${me.hs}%` : '–', 'HS%'), stat(`${me.kast}%`, 'KAST', 'Rounds with a kill, assist, survived or traded'),
        stat(`${s.firstKills}/${s.firstDeaths}`, 'FK / FD', 'First kills and first deaths'), stat(`${s.survived}/${d.rounds.length}`, 'Survived'),
        stat(`#${[...d.players].sort((a, b) => b.acs - a.acs).findIndex((p) => p.isMe) + 1}`, 'In lobby', 'Place in the lobby by combat score')) : null),
    me ? h('div', { class: 'banner-actions' },
      h('button', { class: 'primary big', onclick: startReview }, icon(d.myVod ? 'film' : 'play', 16), h('span', { class: 'col' }, h('span', {}, btnLabel), h('small', {}, sub))),
      review ? h('span', { class: 'small muted' }, review.status === 'done' ? 'Reviewed' : `${review.notes || 0} note${review.notes === 1 ? '' : 's'} so far`) : null) : null);
  if (art && art.splash) el.style.backgroundImage = bannerBg(art.splash);
  return el;
}

const KEY_ICON = { opening: 'door', trade: 'users', isolated: 'alone', aim: 'crosshair', multi: 'zap', clutch: 'trophy', advantage: 'scale', postplant: 'bomb', 'role-early': 'shieldOff', tempo: 'timer', utility: 'sparkle', ult: 'star', away: 'eyeOff', top: 'trophy' };
function quickBox(matchId, puuid, jump) {
  let on = pref('quick_analysis', true);
  const box = h('section', { class: 'card quick' });
  const toggle = h('label', { class: 'switch', 'data-tip': 'Show the Quick analysis on every match (remembered)' },
    h('input', { type: 'checkbox', checked: on, onchange: (e) => { on = e.target.checked; setPref('quick_analysis', on); paint(); } }), 'Quick analysis');
  let data = null;
  async function paint() {
    box.classList.toggle('off', !on);
    if (!on) { fill(box, h('div', { class: 'quick-head' }, icon('sparkle', 15), toggle, h('span', { class: 'muted small' }, 'hidden'))); return; }
    fill(box, h('div', { class: 'quick-head' }, icon('sparkle', 15), toggle), h('p', { class: 'muted small' }, 'Reading the match…'));
    if (!data) data = await api.get(`/api/matches/${matchId}/quick?puuid=${encodeURIComponent(puuid)}`).catch((err) => ({ error: err.message }));
    if (!on) return;
    if (data.error || data.empty) { fill(box, h('div', { class: 'quick-head' }, icon('sparkle', 15), toggle), h('p', { class: 'muted small' }, data.error || 'No analysis for this match yet.')); return; }
    const item = (x, kind) => h('li', { class: kind },
      h('span', { class: 'qi-ico' }, icon(KEY_ICON[x.key] || (kind === 'good' ? 'check' : 'warn'), 14)),
      h('span', { class: 'qi-text' }, x.text),
      x.rounds.length ? h('span', { class: 'qi-rounds' }, x.rounds.slice(0, 8).map((n) => h('button', { class: 'rnum num', onclick: () => jump(n), 'data-tip': `Open round ${n}` }, n))) : null);
    const so = data.standout;
    fill(box, 
      h('div', { class: 'quick-head' }, icon('sparkle', 15), toggle, h('span', { class: 'quick-headline' }, data.headline)),
      h('div', { class: 'quick-cols' },
        h('div', {}, h('h3', { class: 'good' }, 'Went well'), data.good.length ? h('ul', { class: 'qlist' }, data.good.map((x) => item(x, 'good'))) : h('p', { class: 'muted small' }, 'Nothing stood out.')),
        h('div', {}, h('h3', { class: 'bad' }, 'Leaked'), data.bad.length ? h('ul', { class: 'qlist' }, data.bad.map((x) => item(x, 'bad'))) : h('p', { class: 'muted small' }, 'Nothing leaked clearly.'))),
      so ? h('div', { class: 'standout' },
        agentImg(so.agentId, 'so-agent'),
        h('div', { class: 'so-main' },
          h('div', {}, nameTag(`${so.name}#${so.tag}`, so.team === 'your team' ? 'ally' : 'enemy'), h('span', { class: 'muted small' }, ` ${so.agent} · ${so.team} · ${so.acs} ACS (you ${so.myAcs}) · ${so.kda}`)),
          so.better.length ? h('ul', { class: 'so-better small' }, so.better.map((t) => h('li', {}, t))) : null,
          so.rounds.length ? h('div', { class: 'so-rounds small' }, h('span', { class: 'muted' }, 'Their rounds to watch: '), so.rounds.map((r) => h('button', { class: 'chip small', onclick: () => jump(r.round), 'data-tip': r.why }, `R${r.round}`))) : null),
        h('span', { class: 'so-label small muted' }, so.sameRole ? `Best ${String(so.role || '').toLowerCase()} in the lobby` : 'Best player in the lobby')) : null);
  }
  paint();
  return box;
}

