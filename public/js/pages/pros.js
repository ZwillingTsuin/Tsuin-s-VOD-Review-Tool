import { api, pref, setPref } from '../api.js';
import { h, put, toast, shortDate, clockS, emptyState, stagger, ago, fill } from '../ui.js';
import { icon } from '../icons.js';
import { mapArt, agentImg } from '../assets.js';

export const KINDS = {
  clutch: { label: 'Clutches', one: 'Clutch', ico: 'alone', what: 'Last one alive: how they isolate fights, use the spike and the timer, and pick the order of the duels.' },
  retake: { label: 'Retakes', one: 'Retake', ico: 'shield', what: 'Spike down, they come back: where they enter from, what utility clears first, how they trade.' },
  postplant: { label: 'Post-plant', one: 'Post-plant', ico: 'bomb', what: 'Holding a planted spike: off-site angles, crossfires, when to play for time.' },
  hit: { label: 'Site takes', one: 'Site take', ico: 'door', what: 'An attack onto a site: the timing, the utility before the entry, who clears which angle.' },
  opening: { label: 'Openings', one: 'Opening', ico: 'crosshair', what: 'The first duel of the round: how they find first contact, the angle and the timing.' },
  hold: { label: 'Holds', one: 'Hold', ico: 'shield', what: 'Stopping an attack: positioning, re-peeks, when to fall back.' },
  game: { label: 'Whole games', one: 'Whole game', ico: 'film', what: 'A full match: comms, rotations, economy, how they adapt from round to round.' },
};

export async function render(root) {
  const [facets, pros, sync] = await Promise.all([
    api.get('/api/plays/facets').catch(() => ({ players: [], kinds: [], maps: [], agents: [], roles: [] })),
    api.get('/api/pros').catch(() => []),
    api.get('/api/vod/sync').catch(() => ({ enabled: false })),
  ]);
  const syncLine = h('span', { class: 'small muted' });
  const paintSync = (s) => { syncLine.textContent = !s.enabled ? '' : s.running ? 'Checking Twitch…' : s.error ? `Twitch: ${s.error}` : s.at ? `VODs checked ${ago(s.at)}` : 'VODs are checked every 2 hours'; };
  paintSync(sync);
  const syncBtn = sync.enabled ? h('button', { class: 'quiet', 'data-tip': 'Look for new VODs and plays now (also runs every 2 hours)', onclick: async () => {
    syncBtn.disabled = true; syncBtn.classList.add('spin'); paintSync({ enabled: true, running: true });
    try { const s = await api.post('/api/vod/sync'); const added = Object.values(s.players || {}).reduce((n, x) => n + (x.added || 0), 0); paintSync(s); toast(added ? `${added} new plays` : 'No new plays'); if (added) location.reload(); }
    catch (err) { toast(err.message, 'bad'); } finally { syncBtn.disabled = false; syncBtn.classList.remove('spin'); }
  } }, icon('refresh', 14), 'Check VODs') : null;
  put(root, h('div', { class: 'page-head' }, h('h1', {}, 'Pro review'), h('div', { class: 'filters' }, syncLine, syncBtn, h('a', { class: 'btn quiet', href: '#/settings' }, icon('users', 14), 'Manage pros'))));

  const total = facets.kinds.reduce((s, k) => s + k.n, 0);
  if (!pros.length) {
    put(root, emptyState(icon('star', 26), 'No pros yet', 'Add players you want to learn from (their Riot IDs and Twitch channel). Their clutches, retakes and site takes then show up here with the VOD at that moment.', h('a', { class: 'btn primary', href: '#/settings' }, icon('plus', 14), 'Add a pro')));
    return;
  }
  if (!sync.enabled && !total) {
    put(root, emptyState(icon('film', 26), 'Twitch is not set up', 'The plays come from the pros\' Twitch VODs, so this needs a Twitch Client ID and Secret (free, a few minutes). Insights already compares you with your pros without it.', h('a', { class: 'btn primary', href: '#/settings' }, 'Set up Twitch')));
    return;
  }
  if (!total) {
    const noChannel = pros.filter((p) => !p.twitch);
    const downloading = pros.some((p) => p.downloaded < p.matches);
    const check = noChannel.length < pros.length ? h('button', { class: 'primary', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true; b.classList.add('spin');
      try { const s = await api.post('/api/vod/sync'); const added = Object.values(s.players || {}).reduce((n, x) => n + (x.added || 0), 0); if (added) location.reload(); else toast('No plays found in their VODs yet', 'bad'); }
      catch (err) { toast(err.message, 'bad'); } finally { b.disabled = false; b.classList.remove('spin'); }
    } }, icon('refresh', 14), 'Check their VODs now') : null;
    put(root, emptyState(icon('hourglass', 26), 'No plays yet',
      noChannel.length === pros.length ? 'None of your pros has a Twitch channel set. Add it in Settings.'
        : `${downloading ? `Their matches are downloading (${pros.map((p) => `${p.name}: ${p.downloaded}/${p.matches}`).join(', ')}). ` : ''}Plays appear when a downloaded match is covered by a VOD Twitch still has. The VODs are checked by themselves after each download.`, check));
    return;
  }

  const st = { kind: pref('pros_kind', ''), player: pref('pros_player', ''), map: pref('pros_map', ''), agent: '', role: pref('pros_role', ''), status: 'open', sort: pref('pros_sort', 'foryou'), offset: 0 };
  const kinds = h('div', { class: 'kind-bar' });
  const list = h('div', { class: 'play-list' });
  const more = h('button', { class: 'quiet more', hidden: true, onclick: () => load(true) });
  const about = h('p', { class: 'small muted kind-about' });
  const sel = (key, label, rows, fmt = (x) => x.v) => h('select', { 'aria-label': label, onchange: (e) => { st[key] = e.target.value; if (key !== 'agent') setPref(`pros_${key}`, st[key]); load(); } },
    h('option', { value: '' }, label), rows.map((x) => h('option', { value: x.v, selected: st[key] === x.v }, `${fmt(x)} (${x.n})`)));
  const paintKinds = () => {
    fill(kinds, h('button', { class: `chip${!st.kind ? ' on' : ''}`, onclick: () => setKind('') }, 'All', h('span', { class: 'n' }, total)),
      ...Object.entries(KINDS).map(([k, v]) => { const f = facets.kinds.find((x) => x.v === k); return f ? h('button', { class: `chip${st.kind === k ? ' on' : ''}`, onclick: () => setKind(k) }, icon(v.ico, 13), v.label, h('span', { class: 'n' }, f.n)) : null; }));
    about.textContent = st.kind && KINDS[st.kind] ? `What to watch for: ${KINDS[st.kind].what}` : '';
  };
  const setKind = (k) => { st.kind = k; setPref('pros_kind', k); paintKinds(); load(); };
  put(root, kinds, about,
    h('div', { class: 'filters wrap' },
      sel('player', 'All pros', facets.players, (x) => x.name), sel('map', 'All maps', facets.maps), sel('role', 'All roles', facets.roles), sel('agent', 'All agents', facets.agents),
      h('select', { 'aria-label': 'Status', onchange: (e) => { st.status = e.target.value; load(); } }, [['open', 'To watch'], ['reviewed', 'Reviewed'], ['all', 'All']].map(([v, l]) => h('option', { value: v }, l))),
      h('span', { class: 'grow' }),
      h('div', { class: 'seg small', 'data-tip': 'For you: plays on your agents, your role and your maps first' }, ...[['foryou', 'For you'], ['best', 'Best'], ['newest', 'Newest']].map(([v, l]) =>
        h('button', { class: st.sort === v ? 'on' : '', onclick: (e) => { st.sort = v; setPref('pros_sort', v); e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); load(); } }, l)))),
    list, more);
  paintKinds();

  async function load(append = false) {
    if (!append) st.offset = 0;
    const q = new URLSearchParams({ limit: 24, offset: st.offset, status: st.status, sort: st.sort });
    for (const k of ['kind', 'player', 'map', 'agent', 'role']) if (st[k]) q.set(k, st[k]);
    const { total: n, plays } = await api.get('/api/plays?' + q);
    if (!append) fill(list);
    if (!plays.length && !append) list.append(h('p', { class: 'muted' }, 'Nothing here with these filters.'));
    const first = list.childElementCount;
    list.append(...plays.map(playCard));
    if (!append) stagger(list, 12); else [...list.children].slice(first).forEach((c) => c.classList.add('rise'));
    st.offset += plays.length;
    more.hidden = st.offset >= n;
    more.textContent = `Show more (${n - st.offset})`;
  }
  await load();
}

export const twitchAvatar = (src, name = '', size = 18) => (src ? h('img', { class: 'tw-avatar', src, alt: name, width: size, height: size, loading: 'lazy', 'data-tip': name || null }) : null);

export function playCard(p) {
  const art = mapArt(p.map), k = KINDS[p.kind] || {};
  return h('a', { class: `play${p.reviewed ? ' reviewed' : ''}`, href: `#/play/${p.id}` },
    h('span', { class: 'play-art', style: art && art.list ? { backgroundImage: `url("${art.list}")` } : null }, agentImg(p.agent_id, 'play-agent')),
    h('span', { class: 'play-main' },
      h('span', { class: 'kind-tag' }, icon(k.ico || 'play', 11), k.one || p.kind),
      h('b', {}, p.label),
      h('span', { class: 'small muted play-meta' }, twitchAvatar(p.player_avatar, p.player_name), [p.player_name, p.agent, p.map, p.side, p.round ? `R${p.round}` : null, shortDate(p.vod_start)].filter(Boolean).join(' · '))),
    h('span', { class: 'play-side' },
      p.reviewed ? h('span', { class: 'state done' }, icon('check', 12), 'Reviewed') : p.notes ? h('span', { class: 'state part' }, icon('pencil', 12), p.notes) : null,
      h('span', { class: 'small muted num' }, icon('play', 10), ' ', clockS(p.t)),
      p.expires ? h('span', { class: 'small muted', 'data-tip': 'Twitch deletes this VOD on that day' }, `until ${shortDate(p.expires)}`) : null));
}
