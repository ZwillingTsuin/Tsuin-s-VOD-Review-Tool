// Per round: your team's economy minus the enemy's (bank = credits kept, loadout = value bought), and your own buys.
import { h, put, fill } from '../ui.js';
import { icon } from '../icons.js';
import { s } from './minimap.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const RESULT_ICON = { Elimination: 'crosshair', Detonate: 'bomb', Defuse: 'shield', 'Bomb defused': 'shield', 'Bomb detonated': 'bomb', 'Round timer expired': 'hourglass', Surrendered: 'x' };
const CLS = { eco: 'Eco', half: 'Half buy', full: 'Full buy', pistol: 'Pistol' };
const LETTER = { eco: 'E', half: 'H', full: 'F', pistol: 'P' };

export function economySection(d, { onRound, mode: startMode = 'total' } = {}) {
  const te = d.teamEconomy;
  if (!te || !te.rounds.length) return null;
  let mode = startMode;
  const graph = h('div', { class: 'econ-graph' });
  const modeBtns = h('div', { class: 'seg small' });
  const paintModes = () => fill(modeBtns, ...[['bank', 'Bank'], ['loadout', 'Loadout'], ['total', 'Total']].map(([v, l]) =>
    h('button', { class: mode === v ? 'on' : '', onclick: () => { mode = v; paintModes(); draw(); } }, l)));
  paintModes();

  function draw() {
    const W = 1000, H = 150, padL = 44, padR = 12, padT = 10, padB = 34;
    const rs = te.rounds, n = rs.length;
    const vals = rs.map((r) => r.us[mode] - r.them[mode]);
    const maxAbs = Math.max(5000, Math.ceil(Math.max(...vals.map(Math.abs)) / 5000) * 5000);
    const x = (i) => padL + ((W - padL - padR) * (i + 0.5)) / n, y = (v) => padT + ((H - padT - padB) * (maxAbs - v)) / (2 * maxAbs);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'econ-svg', role: 'img', 'aria-label': `Economy difference per round (${mode})` });
    for (const v of [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs]) {
      svg.append(s('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? 'eg-zero' : 'eg-grid' }));
      svg.append(s('text', { x: padL - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'eg-label' }, v === 0 ? '0' : `${v > 0 ? '' : '-'}${Math.abs(v) / 1000}k`));
    }
    // the area above / below zero, clipped by sign
    const pts = vals.map((v, i) => [x(i), y(v)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const area = `${line}L${pts[n - 1][0].toFixed(1)},${y(0)}L${pts[0][0].toFixed(1)},${y(0)}Z`;
    const id = `ec${Math.random().toString(36).slice(2, 8)}`;
    svg.append(s('defs', {},
      s('clipPath', { id: `${id}u` }, s('rect', { x: 0, y: 0, width: W, height: y(0) })),
      s('clipPath', { id: `${id}d` }, s('rect', { x: 0, y: y(0), width: W, height: H }))));
    svg.append(s('path', { d: area, class: 'eg-area up', 'clip-path': `url(#${id}u)` }), s('path', { d: area, class: 'eg-area down', 'clip-path': `url(#${id}d)` }));
    svg.append(s('path', { d: line, class: 'eg-line up', 'clip-path': `url(#${id}u)` }), s('path', { d: line, class: 'eg-line down', 'clip-path': `url(#${id}d)` }));
    rs.forEach((r, i) => {
      const v = vals[i];
      const tip = `Round ${r.n} (${r.won ? 'won' : 'lost'}${r.result ? `, ${r.result.toLowerCase()}` : ''}): your team ${fmt(r.us[mode])}, enemy ${fmt(r.them[mode])} (${v >= 0 ? '+' : ''}${fmt(v)}) · buys ${r.us.cls} vs ${r.them.cls}`;
      svg.append(s('circle', { cx: x(i), cy: y(v), r: 5, class: `eg-pt ${v >= 0 ? 'up' : 'down'}`, 'data-tip': tip, onclick: onRound ? () => onRound(r.n) : null }));
      svg.append(s('text', { x: x(i), y: H - 20, 'text-anchor': 'middle', class: 'eg-n' }, String(r.n)));
    });
    fill(graph, svg);
    graph.append(h('div', { class: 'eg-results', style: { paddingLeft: `${(padL / W) * 100}%`, paddingRight: `${(padR / W) * 100}%` } },
      rs.map((r) => h('button', { class: `eg-res ${r.won ? 'w' : 'l'}`, 'data-tip': `Round ${r.n}: ${r.won ? 'won' : 'lost'} (${r.result})`, onclick: onRound ? () => onRound(r.n) : null },
        icon(RESULT_ICON[r.result] || 'crosshair', 14)))));
  }
  draw();

  const rows = d.economy || [];
  const judged = rows.filter((e) => !e.pistol && !e.bonus), inSync = judged.filter((e) => e.me.cls === e.team.cls).length, flagged = rows.filter((e) => e.flags.length);
  const buys = rows.length ? h('div', { class: 'econ-buys' },
    h('span', { class: 'small eb-sum' }, icon('coin', 14), h('b', { class: 'num' }, `${inSync}/${judged.length}`), ' of your buys matched the team', flagged.length ? h('span', { class: 'bad' }, ` · ${flagged.length} off`) : null),
    h('span', { class: 'eb-cells' }, rows.map((e, i) => [i === 12 ? h('span', { class: 'sep' }) : null,
      h('button', { class: `ec ${e.me.cls}${e.flags.length ? ' off' : ''} ${e.won ? 'w' : 'l'}`, 'data-tip': `Round ${e.n}: ${CLS[e.me.cls]}, ${e.me.loadout} on you, team ${CLS[e.team.cls].toLowerCase()}${e.bonus ? ' (bonus round)' : ''}${e.flags.length ? '. ' + e.flags.map((f) => f.text).join(' ') : ''}`,
        onclick: onRound ? () => onRound(e.n) : null }, LETTER[e.me.cls])]))) : null;
  const flagList = flagged.length ? h('ul', { class: 'econ-flags small' }, flagged.map((e) => h('li', {},
    h('button', { class: 'rnum num', onclick: onRound ? () => onRound(e.n) : null, 'data-tip': `Open round ${e.n}` }, e.n), e.flags.map((f) => f.text).join(' ')))) : null;

  return h('section', { class: 'card econ' },
    h('div', { class: 'econ-head' },
      h('h2', {}, 'Economy'),
      h('span', { class: 'small muted' }, 'Avg. bank ', h('b', { class: 'us num' }, fmt(te.avg.bank.us)), ' / ', h('b', { class: 'them num' }, fmt(te.avg.bank.them))),
      h('span', { class: 'small muted' }, 'Avg. loadout ', h('b', { class: 'us num' }, fmt(te.avg.loadout.us)), ' / ', h('b', { class: 'them num' }, fmt(te.avg.loadout.them))),
      h('span', { class: 'grow' }), modeBtns),
    graph, buys, flagList);
}

