import { h, fill } from '../ui.js';
import { agentImg, tierImg, tierName } from '../assets.js';

const COLS = [
  ['acs', 'ACS', 'Average combat score'], ['kills', 'K', 'Kills'], ['deaths', 'D', 'Deaths'], ['assists', 'A', 'Assists'],
  ['pm', '+/-', 'Kills minus deaths'], ['kd', 'K/D', 'Kills per death'], ['ddDelta', 'DDΔ', 'Damage dealt minus damage taken, per round'],
  ['adr', 'ADR', 'Average damage per round'], ['hs', 'HS%', 'Headshot share of all hits'], ['kast', 'KAST', 'Rounds with a kill, assist, survived or traded'],
  ['fk', 'FK', 'First kills'], ['fd', 'FD', 'First deaths'], ['mk', 'MK', 'Rounds with 2 or more kills'],
];
const PARTY_COLORS = ['#3ea1ff', '#ffb547', '#b77bff', '#42d392', '#ff7aa8'];

export function scoreboard(d) {
  let sort = 'acs', dir = -1;
  const wrap = h('section', { class: 'card sb-wrap' });
  const myTeam = d.me ? d.me.team : 'Blue', other = myTeam === 'Red' ? 'Blue' : 'Red';
  const partyColor = new Map();
  for (const team of [myTeam, other]) {
    const sizes = new Map();
    for (const p of d.players.filter((x) => x.team === team && x.party)) sizes.set(p.party, (sizes.get(p.party) || 0) + 1);
    let i = 0;
    for (const [party, n] of sizes) if (n >= 2) partyColor.set(party, PARTY_COLORS[i++ % PARTY_COLORS.length]);
  }
  const val = (p, k) => (k === 'pm' ? p.kills - p.deaths : p[k] ?? -Infinity);
  const signed = (v) => `${v > 0 ? '+' : ''}${v}`;

  function table(team, label, score, avgTier) {
    const players = d.players.filter((p) => p.team === team).sort((a, b) => dir * (val(a, sort) - val(b, sort)) || b.acs - a.acs);
    const head = h('tr', { class: `sb-head ${team === myTeam ? 'us' : 'them'}` },
      h('th', { class: 'sb-team' }, h('span', {}, label), h('b', { class: 'num' }, score), avgTier ? h('span', { class: 'sb-avg' }, 'avg ', tierImg(avgTier, 'tier-xs'), tierName(avgTier)) : null),
      h('th', {}, 'Rank'),
      COLS.map(([k, l, tip]) => h('th', { class: `num sortable${sort === k ? ' on' : ''}`, 'data-tip': tip, onclick: () => { if (sort === k) dir = -dir; else { sort = k; dir = -1; } draw(); } }, l, sort === k ? (dir < 0 ? ' ▾' : ' ▴') : '')));
    const rows = players.map((p) => h('tr', { class: p.isMe ? 'me' : '' },
      h('td', { class: 'sb-player' },
        h('span', { class: 'sb-party', style: { background: partyColor.get(p.party) || 'transparent' }, 'data-tip': partyColor.has(p.party) ? 'Queued together' : null }),
        h('span', { 'data-tip': p.agent || null }, agentImg(p.agentId, 'sb-agent', p.agent || '')),
        h('span', { class: 'sb-name' }, h('b', {}, p.name), h('span', { class: 'muted' }, `#${p.tag}`))),
      h('td', { class: 'sb-rank' }, tierImg(p.tier, 'tier-sm')),
      h('td', { class: 'num strong' }, p.acs), h('td', { class: 'num' }, p.kills), h('td', { class: 'num' }, p.deaths), h('td', { class: 'num' }, p.assists),
      h('td', { class: `num ${p.kills - p.deaths > 0 ? 'good' : p.kills - p.deaths < 0 ? 'bad' : ''}` }, signed(p.kills - p.deaths)),
      h('td', { class: `num ${p.kd >= 1 ? 'good' : 'bad'}` }, p.kd.toFixed(1)),
      h('td', { class: `num ${p.ddDelta > 0 ? 'good' : p.ddDelta < 0 ? 'bad' : ''}` }, signed(p.ddDelta)),
      h('td', { class: 'num' }, p.adr), h('td', { class: 'num' }, p.hs != null ? `${p.hs}%` : '–'), h('td', { class: 'num' }, `${p.kast}%`),
      h('td', { class: 'num' }, p.fk), h('td', { class: 'num' }, p.fd), h('td', { class: 'num' }, p.mk)));
    return [head, ...rows];
  }
  function draw() {
    fill(wrap, h('div', { class: 'sb-scroll' }, h('table', { class: 'sb' },
      h('tbody', {}, table(myTeam, d.me ? 'Your team' : 'Blue', d.score.us, d.avgTier && d.avgTier.us), table(other, d.me ? 'Enemy team' : 'Red', d.score.them, d.avgTier && d.avgTier.them)))));
  }
  draw();
  return wrap;
}
