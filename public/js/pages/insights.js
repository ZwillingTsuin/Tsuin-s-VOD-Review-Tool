import { api, pref, setPref } from '../api.js';
import { h, put, help, pct, emptyState, shortDate, clockMs, stagger, fill } from '../ui.js';
import { icon } from '../icons.js';
import { agentImg, mapArt } from '../assets.js';
import { minimap, addHeat, calloutToggle, mapToggle, uvOf } from '../components/minimap.js';

const FMT = {
  pct: (v) => pct(v), dec: (v) => (v == null ? '–' : v.toFixed(2)), int: (v) => (v == null ? '–' : String(Math.round(v))),
  s: (v) => (v == null ? '–' : `${(v / 1000).toFixed(1)} s`), m: (v) => (v == null ? '–' : `${Math.round(v)} m`), idx: (v) => (v == null ? '–' : String(Math.round(v * 100))),
};
const MEANS = {
  medianContactT: 'When the first fight of a round happens. Earlier = going for first contact instead of waiting for it.',
  castsPr: 'Basic abilities per round. More = fights set up with utility instead of dry peeks.',
  fkpr: 'How often the first kill of the round is theirs.', fdpr: 'How often they die first.',
  openingWin: 'Of the opening duels taken, how many are won.', fdTradedPct: 'When dying first, how often a teammate trades it: an entry played to be traded.',
  tradedPct: 'How often deaths are traded within 5 s.', tradeKillPct: 'How many kills are trades for a teammate.',
  earlyDeathPct: 'Deaths in the first 20 s of the round.', medianDeathT: 'The typical round time of death.',
  isolatedPct: 'Deaths with no teammate within 15 m: nobody could trade.', medianIso: 'Distance to the nearest living teammate at death.',
  upDeathsPr: 'Deaths while the team had 2+ more players alive.', oneTapPct: 'Kills where the only hit was one headshot: the closest the data gets to first-bullet accuracy.',
  killHsPct: 'Head hits out of all hits on the players they killed.', spaceAtKill: 'Where kills happen, own spawn (0) to enemy spawn (100).',
  spaceAtDeath: 'Where deaths happen, own spawn (0) to enemy spawn (100).', medianKillD: 'Typical distance of kills.', medianDeathD: 'Typical distance of deaths.',
  ppOnSpikePct: 'After a plant: deaths within 12 m of the spike instead of from off-site.', survival: 'Rounds still alive at the end.',
};
const TILES = [['kpr', 'Kills / round', 'crosshair'], ['adr', 'Damage / round', 'zap'], ['kast', 'KAST', 'check'], ['openingWin', 'Opening duels won', 'door'],
  ['tradedPct', 'Deaths traded', 'users'], ['killHsPct', 'Headshot share', 'target'], ['oneTapPct', 'One-bullet kills', 'drop'], ['medianContactT', 'First fight at', 'timer']];
const GROUPS = [['impact', 'Impact'], ['opening', 'Opening duels'], ['team', 'Playing with the team'], ['positioning', 'Positioning and timing'], ['aim', 'Aim'], ['utility', 'Utility']];
const SCEN = {
  'entry-untraded': ['Entry not traded', 'door'], 'plant-on-site': ['Early plant, died on the spike', 'bomb'], 'up-players': ['Died while up 2+', 'scale'],
  isolated: ['Isolated death', 'alone'], 'role-early': ['Controller / sentinel dead early', 'shieldOff'],
};
const WHY = { up: ['Up 2+', 'Your team was up 2+ players'], away: ['Looking away', 'Killed from an angle you weren\'t looking at, no shot back'], alone: ['Alone', 'Nobody within 20 m on attack, not traded'],
  entry: ['Untraded entry', 'Opening death, not traded'], 'my-spot': ['Your spot', 'You die here far more often than your lobbies'], rare: ['Rare spot', 'Your lobbies rarely die here'] };

export async function render(root) {
  const st = {
    scope: pref('ins_scope', 'default'), side: '', days: Number(pref('ins_days', 0)) || 0, map: '', role: pref('ins_role', ''),
    target: pref('ins_target', 'lobby'),
  };
  const head = h('div', { class: 'page-head' }, h('h1', {}, 'Insights', help('Everything comes from the kill data of your downloaded matches: where everyone stood at each kill, hits, the spike, the economy. Numbers are compared with the benchmark you pick, on the same role.')));
  const filters = h('div', { class: 'filters wrap ins-filters' });
  const body = h('div', { class: 'ins' });
  put(root, head, filters, body);
  let alive = true, timer = null, token = 0;

  async function load() {
    const my = ++token;
    fill(body, h('p', { class: 'muted loading' }, h('i', { class: 'spinner' }), 'Reading your matches…'));
    const q = new URLSearchParams({ scope: st.scope, side: st.side, days: st.days, map: st.map, role: st.role });
    let mine, cmp;
    try {
      [mine, cmp] = await Promise.all([api.get(`/api/insights?${q}`), api.get(`/api/compare?${q}&target=${encodeURIComponent(st.target)}`).catch((err) => ({ error: err.message }))]);
    } catch (err) { fill(body, h('p', { class: 'bad' }, err.message)); return; }
    if (!alive || my !== token) return;
    if (cmp.error && st.target !== 'lobby') { st.target = 'lobby'; setPref('ins_target', 'lobby'); return load(); }
    paintFilters(mine, cmp);
    paint(mine, cmp);
    clearTimeout(timer);
    if (mine.coverage.backfill && mine.coverage.backfill.running) timer = setTimeout(load, 45000);
  }

  function paintFilters(mine, cmp) {
    const set = (k, v, save) => { st[k] = v; if (save) setPref(save, v); load(); };
    const selectEl = (label, value, opts, onChange) => h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
    const roles = Object.entries(cmp.roleCount || mine.roleCount || {}).sort((a, b) => b[1] - a[1]);
    const maps = Object.entries(mine.mapCount || {}).sort((a, b) => b[1].n - a[1].n);
    fill(filters, 
      selectEl('Accounts', st.scope, [['default', 'Your accounts'], ['all', 'All accounts (with smurfs)'], ...mine.accounts.filter((a) => a.puuid).map((a) => [a.puuid, a.riotId])], (v) => set('scope', v, 'ins_scope')),
      selectEl('Role', st.role, [['', `Your main role${mine.role ? ` (${mine.role})` : ''}`], ['all', 'All roles'], ...roles.map(([r, n]) => [r, `${r} (${n})`])], (v) => set('role', v, 'ins_role')),
      selectEl('Side', st.side, [['', 'Both sides'], ['attack', 'Attack'], ['defense', 'Defense']], (v) => set('side', v)),
      selectEl('Map', st.map, [['', 'All maps'], ...maps.map(([m, x]) => [m, `${m} (${x.n})`])], (v) => set('map', v)),
      selectEl('Range', st.days, [[0, 'All time'], [90, 'Last 90 days'], [30, 'Last 30 days'], [14, 'Last 14 days']], (v) => set('days', Number(v), 'ins_days')),
      h('span', { class: 'grow' }),
      h('span', { class: 'small muted' }, 'Compare with'),
      selectEl('Compare with', st.target, [['lobby', `Your lobbies (other ${cmp.role ? cmp.role.toLowerCase() + 's' : 'players'})`], ['standouts', 'Standouts (best of each lobby)'], ...mine.pros.map((p) => [p.id, p.name])], (v) => set('target', v, 'ins_target')));
  }

  function paint(mine, cmp) {
    fill(body);
    const c = mine.coverage, b = c.backfill || {};
    put(body, h('p', { class: 'small muted cov' }, b.running ? h('i', { class: 'spinner' }) : icon('info', 13),
      ` ${c.analysed} of ${c.matches} matches analysed`, b.running ? ` · downloading the rest (${b.done}/${b.total}), this page refreshes itself` : '',
      cmp.sample ? ` · ${cmp.who.short}: ${cmp.sample.them.matches} match${cmp.sample.them.matches === 1 ? '' : 'es'}, ${cmp.sample.them.rounds} rounds · you: ${cmp.sample.you.rounds} rounds${cmp.role ? ` as ${cmp.role}` : ''}` : ''));
    if (!mine.overall || !mine.overall.rounds) {
      put(body, emptyState(icon('chart', 26), 'Nothing to show yet', c.matches ? 'Your matches are still downloading. This page fills itself.' : 'No matches for these filters.'));
      return;
    }
    // you and the benchmark keep one colour each on the whole page; green / red only mean better / worse
    put(body, h('div', { class: 'ins-legend small' },
      h('span', {}, h('i', { class: 'sw you' }), 'You'), h('span', {}, h('i', { class: 'sw them' }), cmp.who ? cmp.who.name : 'Benchmark'),
      h('span', {}, h('i', { class: 'sw good' }), 'clearly better'), h('span', {}, h('i', { class: 'sw bad' }), 'clearly worse'),
      h('span', { class: 'muted' }, '(only differences that are unlikely to be chance are coloured)')));
    const sections = h('div', { class: 'ins-sections' },
      pool(mine),
      glance(cmp),
      standsOut(cmp),
      mapSection(mine, cmp),
      duelSection(mine, cmp),
      timingSection(cmp),
      scenarioSection(mine),
      cmp.standouts && cmp.standouts.length ? standoutSection(cmp) : null,
      allNumbers(cmp));
    put(body, sections);
    stagger(sections, 8);
  }

  await load();
  return () => { alive = false; clearTimeout(timer); };
}

function pool(mine) {
  const agents = Object.entries(mine.agentCount).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const o = mine.overall;
  return h('section', { class: 'card pool' },
    h('div', { class: 'pool-agents' }, agents.map(([name, x]) => h('div', { class: 'pool-agent', 'data-tip': `${name}: ${x.n} matches, ${Math.round((100 * x.won) / x.n)}% won` },
      agentImg(x.id, 'pa-img'), h('b', { class: 'num' }, x.n), h('small', { class: 'muted' }, `${Math.round((100 * x.won) / x.n)}%`)))),
    h('div', { class: 'pool-sum small muted' }, `${o.rounds} rounds · ${o.kills} kills · ${o.deaths} deaths`));
}

function rowOf(cmp, key) { return (cmp.rows || []).find((r) => r.key === key); }
function verdict(r) {
  if (!r || r.them == null || r.you == null) return 'none';
  if (!r.good || Math.abs(r.z) < 2) return 'even';
  return (r.you > r.them) === (r.good > 0) ? 'better' : 'worse';
}
function glance(cmp) {
  if (!cmp.rows) return null;
  return h('section', { class: 'glance' }, TILES.map(([key, label]) => {
    const r = rowOf(cmp, key);
    if (!r) return null;
    const v = verdict(r), f = FMT[r.fmt];
    return h('div', { class: `gtile ${v}${r.selected ? ' sel' : ''}`, 'data-tip': `${r.label}${r.tip ? `: ${r.tip}` : ''}${r.selected ? ' (standouts are picked for high numbers here, so this one is high by selection)' : ''}` },
      h('small', { class: 'gt-label' }, label),
      h('div', { class: 'gt-vals' }, h('b', { class: 'num you' }, f(r.you)), v === 'better' ? icon('trendUp', 15) : v === 'worse' ? icon('trendDown', 15) : null),
      h('span', { class: 'small them num' }, `${cmp.who.short} ${f(r.them)}`));
  }));
}

function standsOut(cmp) {
  const jumps = cmp.jumps || [];
  return h('section', { class: 'card' },
    h('div', { class: 'sec-head' }, icon('sparkle', 15), h('h2', {}, 'What stands out'), help('Differences big enough that they are unlikely to be chance (about 2 standard errors or more), biggest first. Results like kills and damage are left out: this is about how you play.')),
    jumps.length ? h('div', { class: 'jumps' }, jumps.map((r) => {
      const v = verdict(r), f = FMT[r.fmt];
      return h('div', { class: `jump ${v}` },
        h('div', { class: 'jump-top' }, h('b', {}, r.label), h('span', { class: 'jump-vals num' }, h('span', { class: 'you' }, `you ${f(r.you)}`), h('span', { class: 'them' }, ` · ${cmp.who.short} ${f(r.them)}`))),
        bar(r),
        h('p', { class: 'small muted' }, MEANS[r.key] || r.tip || ''));
    })) : h('p', { class: 'muted' }, `No clear difference to ${cmp.who.name.toLowerCase()} yet${cmp.sample && cmp.sample.you.rounds < 300 ? ': more matches make smaller differences visible' : ''}.`));
}
function bar(r) {
  const max = Math.max(Math.abs(r.you || 0), Math.abs(r.them || 0)) || 1;
  return h('div', { class: 'duo' },
    h('span', { class: 'duo-row' }, h('i', { class: 'you', style: { width: `${(Math.abs(r.you || 0) / max) * 100}%` } })),
    h('span', { class: 'duo-row' }, h('i', { class: 'them', style: { width: `${(Math.abs(r.them || 0) / max) * 100}%` } })));
}

function mapSection(mine, cmp) {
  const maps = Object.entries(mine.mapCount || {}).sort((a, b) => b[1].n - a[1].n).map(([m]) => m).filter((m) => mine.maps[m]);
  if (!maps.length) return null;
  let map = maps[0], layer = 'death', why = null;
  const box = h('section', { class: 'card' });
  const withThem = cmp.points && cmp.points.length;
  function paint() {
    const info = mine.maps[map] || (cmp.maps || {})[map];
    const pts = mine.points.filter((p) => p.map === map && p.kind === layer && p.u != null);
    const shown = why ? pts.filter((p) => p.why && p.why.includes(why)) : pts;
    const look = pts.filter((p) => p.cls === 'look').length;
    const tabs = h('div', { class: 'map-tabs' }, maps.map((m) => { const art = mapArt(m); return h('button', { class: `map-tab${m === map ? ' on' : ''}`, style: art && art.list ? { backgroundImage: `url("${art.list}")` } : null, onclick: () => { map = m; why = null; paint(); } }, h('span', {}, m)); }));
    const mm = info ? minimap({ src: info.minimap, callouts: info.callouts, cls: 'ins-map' }) : null;
    const heat = mm ? mapToggle({ key: 'ins_heat', label: 'Heatmap', ico: 'layers', tip: 'Show where it happens most as a heatmap', onChange: () => paint() }) : null;
    if (mm) {
      if (heat.isOn()) addHeat(mm, shown.map((p) => [p.u, p.v]), { color: layer === 'death' ? 'red' : 'blue' });
      else for (const p of shown) {
        const tip = `${p.kind === 'death' ? `Died to ${p.opp}` : `Killed ${p.opp}`} · ${p.call || ''} · ${clockMs(p.t)} into round ${p.round} · ${shortDate(p.date)}${p.why && p.why.length ? ` · ${p.why.map((w) => (WHY[w] || [w])[0]).join(', ')}` : ''}. Click to open the round.`;
        const go = () => { location.hash = `#/match/${p.match}/${p.puuid}/r${p.round}`; };
        if (layer === 'death') mm.cross([p.u, p.v], { cls: `pt ${p.cls || 'normal'}`, size: 8, tip, onclick: go, layer: p.cls === 'look' ? mm.top : mm.base });
        else mm.dot([p.u, p.v], { cls: 'pt kill', r: 7, tip, onclick: go });
      }
    }
    let theirMap = null;
    if (withThem && info) {
      const tp = cmp.points.filter((p) => p.map === map && p.kind === layer && p.u != null);
      theirMap = minimap({ src: info.minimap, callouts: info.callouts, cls: 'ins-map' });
      if (heat.isOn()) addHeat(theirMap, tp.map((p) => [p.u, p.v]), { color: layer === 'death' ? 'red' : 'blue' });
      else for (const p of tp) { if (layer === 'death') theirMap.cross([p.u, p.v], { cls: `pt ${p.cls || 'normal'}`, size: 8, tip: `${p.call || ''} · ${clockMs(p.t)}` }); else theirMap.dot([p.u, p.v], { cls: 'pt kill', r: 7 }); }
    }
    const whyCounts = Object.keys(WHY).map((k) => [k, pts.filter((p) => p.why && p.why.includes(k)).length]).filter(([, n]) => n);
    // keep the height while rebuilding, so the page doesn't jump
    if (box.offsetHeight) { box.style.minHeight = `${box.offsetHeight}px`; requestAnimationFrame(() => { box.style.minHeight = ''; }); }
    const spots = spotsTable(mine, map);
    fill(box,
      h('div', { class: 'sec-head' }, icon('map', 15), h('h2', {}, layer === 'death' ? 'Where you die' : 'Where you get kills'),
        help('Every death (×) or kill (•) of yours on this map. Deaths in red are worth a look (a reason is listed on hover); grey ones are where fights normally happen in your lobbies. Click one to open that round.'),
        h('span', { class: 'grow' }),
        h('div', { class: 'seg small' }, ...[['death', 'Deaths'], ['kill', 'Kills']].map(([v, l]) => h('button', { class: layer === v ? 'on' : '', onclick: () => { layer = v; why = null; paint(); } }, l))),
        heat, mm ? calloutToggle(mm) : null),
      tabs,
      layer === 'death' && whyCounts.length ? h('div', { class: 'filters wrap' }, h('span', { class: 'small muted' }, `${look} of ${pts.length} worth a look:`),
        whyCounts.map(([k, n]) => h('button', { class: `chip small${why === k ? ' on' : ''}`, 'data-tip': WHY[k][1], onclick: () => { why = why === k ? null : k; paint(); } }, WHY[k][0], h('span', { class: 'n' }, n)))) : null,
      h('div', { class: `map-area${theirMap ? ' pair' : ''}${spots ? '' : ' no-spots'}` },
        mm ? h('div', { class: 'map-cell' }, h('b', { class: 'small you' }, `You · ${shown.length}`), mm.el) : h('p', { class: 'muted' }, 'No map data'),
        theirMap ? h('div', { class: 'map-cell' }, h('b', { class: 'small them' }, `${cmp.who.short} · ${cmp.points.filter((p) => p.map === map && p.kind === layer).length}`), theirMap.el) : null,
        spots ? h('div', { class: 'spots' }, h('h3', {}, 'Where you die most'), spots) : null));
  }
  paint();
  return box;
}
function spotsTable(mine, map) {
  const rows = mine.spots.filter((s) => s.map === map && s.deaths >= 2).slice(0, 10);
  if (!rows.length) return null;
  return h('table', { class: 'tbl small' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Spot'), h('th', { class: 'num' }, 'Deaths'), h('th', { class: 'num', 'data-tip': 'Share of your deaths on this map that happen here' }, 'You'), h('th', { class: 'num', 'data-tip': 'Share of your lobbies\' deaths on this map that happen here' }, 'Lobbies'), h('th', { class: 'num', 'data-tip': 'Duels you won there / all your duels there' }, 'Won'))),
    h('tbody', {}, rows.map((s) => h('tr', { class: s.over ? 'warn' : '' },
      h('td', {}, s.call, s.over ? h('span', { class: 'tag bad' }, 'your spot') : null),
      h('td', { class: 'num' }, s.deaths), h('td', { class: 'num' }, pct(s.myShare)), h('td', { class: 'num muted' }, pct(s.lobbyShare)),
      h('td', { class: 'num' }, s.n ? `${s.won}/${s.n}` : '–')))));
}

function duelSection(mine, cmp) {
  const winRow = (label, won, lost, them) => {
    const n = won + lost, p = n ? won / n : null;
    return h('div', { class: 'wr' }, h('span', { class: 'wr-label small' }, label),
      h('span', { class: 'wr-bar' }, h('i', { class: 'won', style: { width: `${n ? (won / n) * 100 : 0}%` } })),
      h('span', { class: 'num small' }, p == null ? '–' : pct(p)), h('span', { class: 'num small muted' }, `${n}`),
      them != null ? h('span', { class: 'num small muted', 'data-tip': `${cmp.who.short}` }, pct(them)) : h('span'));
  };
  const bands = cmp.bands || {};
  return h('section', { class: 'card' },
    h('div', { class: 'sec-head' }, icon('crosshair', 15), h('h2', {}, 'Duels'), help('Duels you won (a kill) and lost (a death), by distance and by weapon. The last column is the benchmark\'s win rate at that distance.'),
      h('span', { class: 'grow' }), h('span', { class: 'ins-legend small inline' }, h('span', {}, h('i', { class: 'sw good' }), 'won'), h('span', {}, h('i', { class: 'sw bad' }), 'lost'))),
    h('div', { class: 'duel-cols' },
      h('div', {}, h('h3', {}, 'By distance'), h('div', { class: 'wr-head small muted' }, h('span'), h('span'), h('span', {}, 'won'), h('span', {}, 'n'), h('span', {}, cmp.who.short)),
        (mine.byDistance || []).map((x) => { const t = bands.them && bands.them[x.key]; return winRow(x.key, x.won, x.lost, t && t.won + t.lost ? t.won / (t.won + t.lost) : null); })),
      h('div', {}, h('h3', {}, 'By your weapon'), h('div', { class: 'wr-head small muted' }, h('span'), h('span'), h('span', {}, 'won'), h('span', {}, 'n'), h('span')),
        (mine.byWeapon || []).filter((x) => x.n >= 5).slice(0, 8).map((x) => winRow(x.key, x.won, x.lost, null)))));
}

function timingSection(cmp) {
  if (!cmp.phases) return null;
  const labels = cmp.phases.labels, you = cmp.phases.you, them = cmp.phases.them;
  const tot = (o) => Object.values(o).reduce((a, b) => a + b, 0) || 1;
  const ty = tot(you), tt = tot(them);
  const max = Math.max(...labels.map((l) => Math.max(you[l] / ty, them[l] / tt)), 0.01);
  return h('section', { class: 'card' },
    h('div', { class: 'sec-head' }, icon('timer', 15), h('h2', {}, 'When you die'), help('Share of deaths by round time. Dying early more often than the benchmark usually means taking fights before the team can play off them.')),
    h('div', { class: 'phase-chart' }, labels.map((l) => h('div', { class: 'phase' },
      h('div', { class: 'phase-bars' },
        h('i', { class: 'you', style: { height: `${((you[l] / ty) / max) * 100}%` }, 'data-tip': `You: ${pct(you[l] / ty)} of your deaths` }),
        h('i', { class: 'them', style: { height: `${((them[l] / tt) / max) * 100}%` }, 'data-tip': `${cmp.who.short}: ${pct(them[l] / tt)}` })),
      h('small', {}, l)))),
    h('div', { class: 'legend small' }, h('span', {}, h('i', { class: 'lg-you' }), 'you'), h('span', {}, h('i', { class: 'lg-them' }), cmp.who.short)));
}

function scenarioSection(mine) {
  const list = mine.scenarios || [];
  if (!list.length) return null;
  let key = null;
  const box = h('section', { class: 'card' });
  const paint = () => {
    const counts = Object.keys(SCEN).map((k) => [k, list.filter((x) => x.keys.includes(k)).length]).filter(([, n]) => n);
    const rows = (key ? list.filter((x) => x.keys.includes(key)) : list).slice(0, 24);
    fill(box, 
      h('div', { class: 'sec-head' }, icon('film', 15), h('h2', {}, 'Rounds worth a look'), help('Deaths in situations coaches point at, recent ones first. Open the round, then review the match to see what happened.')),
      h('div', { class: 'filters wrap' }, h('button', { class: `chip small${!key ? ' on' : ''}`, onclick: () => { key = null; paint(); } }, 'All', h('span', { class: 'n' }, list.length)),
        counts.map(([k, n]) => h('button', { class: `chip small${key === k ? ' on' : ''}`, onclick: () => { key = k; paint(); } }, icon(SCEN[k][1], 12), SCEN[k][0], h('span', { class: 'n' }, n)))),
      h('div', { class: 'scen-grid' }, rows.map((x) => {
        const art = mapArt(x.map);
        return h('a', { class: 'scen-card', href: `#/match/${x.match}/${x.puuid}/r${x.round}`, 'data-tip': x.texts.join('\n') },
          h('span', { class: 'sc-art', style: art && art.list ? { backgroundImage: `url("${art.list}")` } : null }, agentImg(x.agentId, 'sc-agent'), h('b', { class: 'sc-round num' }, `R${x.round}`)),
          h('span', { class: 'sc-main' }, h('b', { class: 'small' }, x.map), h('span', { class: 'small muted' }, `${shortDate(x.date)}${x.call ? ` · ${x.call}` : ''}`)),
          h('span', { class: 'sc-why' }, x.keys.map((k) => SCEN[k] ? h('span', { class: 'sc-badge', 'aria-label': SCEN[k][0] }, icon(SCEN[k][1], 14)) : null)));
      })));
  };
  paint();
  return box;
}

function standoutSection(cmp) {
  return h('section', { class: 'card' },
    h('div', { class: 'sec-head' }, icon('trophy', 15), h('h2', {}, 'The standouts of your lobbies'), help('In each match, the player on your role with the highest combat score, when it beat yours: what they did better, and the rounds of theirs worth watching.')),
    h('div', { class: 'so-list' }, cmp.standouts.slice(0, 12).map((s) => h('a', { class: 'so-row', href: `#/match/${s.match}/${s.me}` },
      agentImg(s.agentId, 'scen-agent'),
      h('span', { class: 'scen-main' }, h('span', {}, h('b', {}, `${s.name}#${s.tag}`), h('span', { class: 'small muted' }, ` ${s.agent} · ${s.map} · ${shortDate(s.date)} · ${s.acs} ACS (you ${s.myAcs})`)),
        s.better.slice(0, 2).map((t) => h('span', { class: 'small' }, t))),
      icon('chevRight', 15)))));
}

function allNumbers(cmp) {
  if (!cmp.rows) return null;
  const det = h('details', { class: 'card all-nums' }, h('summary', { class: 'all-sum' }, icon('list', 15), h('h2', {}, 'All numbers'), h('span', { class: 'muted small' }, 'every stat, you next to ' + (cmp.who ? cmp.who.short : 'the benchmark')), h('span', { class: 'grow' }), h('span', { class: 'all-toggle' }, h('span', { class: 'open-t' }, 'Show'), h('span', { class: 'close-t' }, 'Hide'), icon('chevDown', 15))));
  for (const [g, label] of GROUPS) {
    const rows = cmp.rows.filter((r) => r.group === g);
    if (!rows.length) continue;
    det.append(h('h3', {}, label), h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'You'), h('th', { class: 'num' }, cmp.who.short), h('th', { class: 'num', 'data-tip': 'How clear the difference is (standard errors); 2 and more is unlikely to be chance' }, 'Clear?'))),
      h('tbody', {}, rows.map((r) => h('tr', { class: verdict(r) },
        h('td', { 'data-tip': r.tip || MEANS[r.key] || null }, r.label, r.selected ? h('span', { class: 'tag' }, 'by selection') : null),
        h('td', { class: 'num' }, FMT[r.fmt](r.you)), h('td', { class: 'num muted' }, FMT[r.fmt](r.them)),
        h('td', { class: 'num small' }, Math.abs(r.z) >= 2 ? `${Math.abs(r.z).toFixed(1)}×` : '–'))))));
  }
  return det;
}

