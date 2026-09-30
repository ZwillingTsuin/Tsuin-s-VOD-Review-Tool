import { api } from '../api.js';
import { h, put, help, emptyState, shortDate, sqlDate, clockS, stagger, fill, ask, toast } from '../ui.js';
import { icon } from '../icons.js';
import { mapArt, agentImg } from '../assets.js';
import { KINDS } from './pros.js';
import { renderRich } from '../components/editor.js';
import { roundsOf } from '../components/notes.js';

export async function render(root) {
  const [{ reviews, stats }, lessons] = await Promise.all([api.get('/api/reviews'), api.get('/api/lessons').catch(() => [])]);
  put(root, h('div', { class: 'page-head' }, h('h1', {}, 'Reviews')));
  if (!reviews.length) {
    put(root, emptyState(icon('film', 26), 'Nothing reviewed yet', 'Open a match and press "VOD review", or pick a play in Pro review. Everything you write down collects here.',
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/matches' }, 'Your matches'), h('a', { class: 'btn', href: '#/pros' }, 'Pro review'))));
    return;
  }
  const href = (r) => (r.kind === 'play' ? `#/play/${r.play_id}` : `#/review/${r.id}`);
  const open = reviews.filter((r) => r.status !== 'done');

  const maxWeek = Math.max(1, ...stats.byWeek.map((w) => w.n)), maxCat = Math.max(1, ...stats.byCategory.map((c) => c.n));
  const tile = (v, l) => h('div', { class: 'tile' }, h('b', { class: 'num' }, v), h('small', {}, l));
  put(root, h('section', { class: 'rev-stats' },
    h('div', { class: 'tiles' }, tile(stats.reviews, 'reviews'), tile(stats.done, 'finished'), tile(stats.notes, 'notes'), tile(stats.lessons, 'key lessons')),
    stats.byWeek.length >= 2 ? h('div', { class: 'card mini-chart' }, h('small', { class: 'muted' }, 'Notes per week'),
      h('div', { class: 'bars' }, stats.byWeek.map((w) => h('span', { class: 'bar', style: { height: `${Math.max(4, (w.n / maxWeek) * 100)}%` }, 'data-tip': `${w.n} notes (week ${w.wk.slice(5)})` })))) : null,
    stats.byCategory.length ? h('div', { class: 'card cat-chart' }, h('small', { class: 'muted' }, 'What your notes are about'),
      stats.byCategory.slice(0, 7).map((c) => h('div', { class: 'cat-row' }, h('span', { class: 'small' }, c.category), h('span', { class: 'cat-bar' }, h('i', { style: { width: `${(c.n / maxCat) * 100}%` } })), h('span', { class: 'small num muted' }, c.n)))) : null,
    stats.ratings && stats.ratings.length ? h('div', { class: 'card cat-chart' }, h('small', { class: 'muted' }, 'How you rated your games (1 to 5)'),
      stats.ratings.slice(0, 7).map((c) => h('div', { class: 'cat-row', 'data-tip': `${c.category}: ${c.avg.toFixed(1)} on average over ${c.n} game${c.n === 1 ? '' : 's'}, ${c.recent.toFixed(1)} in the last ${Math.min(5, c.n)}` },
        h('span', { class: 'small' }, c.category), h('span', { class: 'cat-bar rating' }, h('i', { style: { width: `${(c.avg / 5) * 100}%` } })),
        h('span', { class: `small num ${c.recent > c.avg + 0.2 ? 'good' : c.recent < c.avg - 0.2 ? 'bad' : 'muted'}` }, c.avg.toFixed(1))))) : null));

  if (open.length) {
    put(root, h('h2', {}, 'Continue where you left off'));
    const grid = h('div', { class: 'rev-cards' }, open.slice(0, 6).map((r) => card(r, href)));
    put(root, grid); stagger(grid, 6);
  }

  if (lessons.length) {
    const byCat = new Map();
    for (const l of lessons) { if (!byCat.has(l.category)) byCat.set(l.category, []); byCat.get(l.category).push(l); }
    put(root, h('h2', {}, icon('star', 16), ' Key lessons', help('Notes you marked as a key lesson, by focus. Click one to go back to where you wrote it.')), h('div', { class: 'lessons' }, [...byCat].map(([cat, ls]) => h('div', { class: 'lesson-group' },
      h('h3', {}, cat, h('span', { class: 'n' }, ls.length)),
      ls.map((l) => h('a', { class: 'lesson', href: l.kind === 'play' ? `#/play/${l.play_id}${l.t != null ? `/${Math.round(l.t)}` : ''}` : `#/review/${l.review_id}` },
        renderRich(l.body), h('span', { class: 'small muted' }, [l.review_title, roundsOf(l).length ? roundsOf(l).map((x) => `R${x}`).join(', ') : 'whole game', l.t != null && !l.rounds ? clockS(l.t) : null].filter(Boolean).join(' · '))))))));
  }

  const search = h('input', { type: 'search', placeholder: 'Search map, agent, pro, title…', 'aria-label': 'Search reviews' });
  const kindSel = h('select', { 'aria-label': 'Kind' }, [['', 'Everything'], ['match', 'Your matches'], ['play', 'Pro plays']].map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div', { class: 'rev-list' });
  const remove = async (r) => {
    if (!(await ask(`Delete this review and its ${r.notes} note${r.notes === 1 ? '' : 's'}? This can't be undone.`, { ok: 'Delete', danger: true }))) return;
    await api.del(`/api/reviews/${r.id}`);
    reviews.splice(reviews.indexOf(r), 1);
    toast('Review deleted');
    paint();
  };
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const rows = reviews.filter((r) => (!kindSel.value || r.kind === kindSel.value) && (!q || [r.title, r.map, r.agent, r.play_map, r.play_agent, r.player_name, r.play_label].some((x) => x && String(x).toLowerCase().includes(q))));
    fill(list, ...(rows.length ? rows.map((r) => row(r, href, remove)) : [h('p', { class: 'muted' }, 'Nothing matches.')]));
  };
  search.addEventListener('input', paint); kindSel.addEventListener('change', paint);
  put(root, h('div', { class: 'sec-head' }, h('h2', {}, 'All reviews'), h('span', { class: 'grow' }), search, kindSel), list);
  paint();
}

function card(r, href) {
  const map = r.map || r.play_map, art = mapArt(map);
  return h('a', { class: 'rev-card', href: href(r), style: art && art.list ? { backgroundImage: `linear-gradient(90deg, rgba(26,26,26,.96) 35%, rgba(26,26,26,.72)), url("${art.list}")` } : null },
    agentImg(r.agent_id || r.play_agent_id, 'rc-agent'),
    h('span', { class: 'rc-main' },
      h('span', { class: 'kind-tag' }, r.kind === 'play' ? [icon((KINDS[r.play_kind] || {}).ico || 'play', 11), r.player_name] : [icon('film', 11), 'Your match']),
      h('b', {}, r.kind === 'play' ? r.play_label : `${map} ${r.rounds_won ?? ''}${r.rounds_won != null ? ':' : ''}${r.rounds_lost ?? ''}`),
      h('span', { class: 'small muted' }, `${r.notes} note${r.notes === 1 ? '' : 's'} · last change ${shortDate(sqlDate(r.updated_at))}`)),
    icon('chevRight', 16));
}
function row(r, href, remove) {
  const map = r.map || r.play_map;
  const rated = r.ratings ? Object.entries(r.ratings) : [];
  return h('div', { class: `rev-row${r.status === 'done' ? ' done' : ''}` },
    h('a', { class: 'rev-row-link', href: href(r) },
      agentImg(r.agent_id || r.play_agent_id, 'rr-agent'),
      h('span', { class: 'rr-main' }, h('b', {}, r.kind === 'play' ? r.play_label : `${map} · ${r.won === 1 ? 'Win' : r.won === 0 ? 'Loss' : ''} ${r.rounds_won ?? ''}–${r.rounds_lost ?? ''}`),
        h('span', { class: 'small muted' }, r.kind === 'play' ? `${r.player_name} · ${(KINDS[r.play_kind] || {}).one || r.play_kind} · ${map}` : `Your match · ${r.agent || ''} · ${r.date ? shortDate(r.date) : ''} · ${r.source === 'none' ? 'minimap' : r.source}`)),
      rated.length ? h('span', { class: 'rr-ratings' }, rated.slice(0, 4).map(([c, n]) => h('span', { class: `rate-pill r${n}`, 'data-tip': `${c}: ${n} of 5` }, n))) : h('span'),
      h('span', { class: 'small muted num' }, `${r.notes} notes`, r.starred ? ` · ${r.starred} ★` : ''),
      r.status === 'done' ? h('span', { class: 'state done' }, icon('check', 12), 'Finished') : h('span', { class: 'state part' }, 'Open')),
    h('button', { class: 'quiet icon-btn', 'aria-label': 'Delete this review', 'data-tip': 'Delete this review', onclick: () => remove(r) }, icon('trash', 14)));
}
