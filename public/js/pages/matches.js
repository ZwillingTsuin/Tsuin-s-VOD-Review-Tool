import { api, pref, setPref } from '../api.js';
import { h, put, toast, dayLabel, emptyState, stagger, fill } from '../ui.js';
import { icon } from '../icons.js';
import { mapArt, agentImg, tierImg, tierName } from '../assets.js';

const PARTY = { 1: 'Solo', 2: 'Duo', 3: '3-stack', 4: '4-stack', 5: '5-stack' };

export async function render(root) {
  const accounts = await api.get('/api/accounts');
  if (!accounts.length) {
    put(root, h('div', { class: 'page-head' }, h('h1', {}, 'Matches')),
      emptyState(icon('user', 26), 'No account yet', 'Add your Riot ID and your matches appear here.', h('a', { class: 'btn primary', href: '#/setup/1' }, 'Set up')));
    return;
  }
  const state = { account: pref('matches_account', ''), open: !!pref('matches_open', false), offset: 0 };
  if (state.account && !accounts.some((a) => a.puuid === state.account)) state.account = '';
  const list = h('div', { class: 'match-list' });
  const more = h('button', { class: 'quiet more', hidden: true, onclick: () => load(true) });
  const accSel = h('select', { 'aria-label': 'Account', onchange: (e) => { state.account = e.target.value; setPref('matches_account', state.account); load(); } },
    h('option', { value: '' }, `All accounts (${accounts.length})`), accounts.map((a) => h('option', { value: a.puuid || '', selected: a.puuid === state.account }, a.riotId)));
  const openBtn = h('button', { class: `chip${state.open ? ' on' : ''}`, onclick: () => { state.open = !state.open; openBtn.classList.toggle('on', state.open); setPref('matches_open', state.open); load(); } }, icon('eye', 13), 'Not reviewed');
  const refresh = h('button', { class: 'quiet', 'data-tip': 'Check your accounts for new games now', onclick: async () => {
    refresh.disabled = true; refresh.classList.add('spin');
    let added = 0;
    for (const a of accounts.filter((x) => !state.account || x.puuid === state.account)) {
      try { added += (await api.post(`/api/accounts/${a.id}/refresh`)).added || 0; } catch (err) { toast(`${a.riotId}: ${err.message}`, 'bad'); }
    }
    toast(added ? `${added} new match${added > 1 ? 'es' : ''}` : 'Up to date');
    refresh.disabled = false; refresh.classList.remove('spin');
    load();
  } }, icon('refresh', 14), 'Refresh');
  put(root, h('div', { class: 'page-head' }, h('h1', {}, 'Matches'), h('div', { class: 'filters' }, accSel, openBtn, refresh)), list, more);

  let lastDay = null, retry = null;
  async function load(append = false) {
    if (!append) { state.offset = 0; lastDay = null; }
    const q = new URLSearchParams({ limit: 40, offset: state.offset, account: state.account, open: state.open ? '1' : '' });
    const { total, matches } = await api.get('/api/matches?' + q);
    if (!append) fill(list);
    if (!matches.length && !append && !state.open) {
      // a new account's history is still being read
      const accs = await api.get('/api/accounts').catch(() => []);
      if (accs.some((a) => a.syncing)) {
        list.append(h('div', { class: 'empty' }, h('i', { class: 'spinner big' }), h('h3', {}, 'Reading your match history…'), h('p', { class: 'muted' }, 'This takes a few seconds per account. The list fills in by itself.')));
        clearTimeout(retry); retry = setTimeout(() => { if (document.body.contains(list)) load(); }, 3000);
        return;
      }
    }
    if (!matches.length && !append) {
      list.append(emptyState(icon('list', 26), state.open ? 'Everything is reviewed' : 'No matches yet',
        state.open ? 'No match left without a finished review.' : 'Your ranked matches appear here as soon as they are downloaded. The first download can take a few minutes.'));
    }
    const frag = document.createDocumentFragment();
    for (const m of matches) {
      const day = new Date(m.date).toDateString();
      if (day !== lastDay) { frag.append(h('div', { class: 'match-day' }, dayLabel(m.date))); lastDay = day; }
      frag.append(matchRow(m, !state.account && accounts.length > 1));
    }
    const first = list.childElementCount;
    list.append(frag);
    if (!append) stagger(list, 14); else [...list.children].slice(first).forEach((c) => c.classList.add('rise'));
    state.offset += matches.length;
    more.hidden = state.offset >= total;
    more.textContent = `Show more (${total - state.offset})`;
  }
  await load();
}

function matchRow(m, showAccount) {
  const art = mapArt(m.map);
  const res = m.won === 1 ? 'W' : m.won === 0 ? 'L' : 'D';
  const hs = m.head != null && m.head + m.body + m.leg ? Math.round((100 * m.head) / (m.head + m.body + m.leg)) : null;
  const tags = [];
  if (m.party) tags.push(h('span', { class: 'mtag', 'data-tip': m.party === 1 ? 'You queued alone' : `You queued as a party of ${m.party}` }, icon(m.party > 1 ? 'users' : 'user', 11), PARTY[m.party] || `${m.party}-stack`));
  if (m.lobby_avg && m.tier > 2) {
    const diff = Math.round((m.tier - m.lobby_avg) * 10) / 10;
    // "higher-ranked lobby" = the other nine were ranked above you
    const [label, cls, ico] = Math.abs(diff) <= 1 ? ['Lobby at your rank', '', 'scale'] : diff < 0 ? ['Higher-ranked lobby', 'down', 'trendUp'] : ['Lower-ranked lobby', 'up', 'trendDown'];
    tags.push(h('span', { class: `mtag ${cls}`, 'data-tip': `The other 9 players averaged ${tierName(Math.round(m.lobby_avg))}, you were ${tierName(m.tier)} (${Math.abs(diff)} division${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'above' : diff < 0 ? 'below' : 'from'} them)` }, icon(ico, 11), label));
  }
  const state = m.review_status === 'done' ? h('span', { class: 'state done' }, icon('check', 12), 'Reviewed')
    : m.notes ? h('span', { class: 'state part' }, icon('pencil', 12), `${m.notes} note${m.notes > 1 ? 's' : ''}`) : null;
  return h('a', { class: `match-row res-${res}`, href: `#/match/${m.match_id}/${m.puuid}` },
    h('span', { class: 'mr-map', style: art && art.list ? { backgroundImage: `url("${art.list}")` } : null }),
    h('span', { class: 'mr-res' }, res),
    h('span', { class: 'mr-main' },
      h('b', {}, m.map || 'Unknown map', m.rr != null ? h('span', { class: `rr ${m.rr > 0 ? 'up' : m.rr < 0 ? 'down' : ''}`, 'data-tip': 'Rank rating won or lost' }, `${m.rr > 0 ? '+' : ''}${m.rr} RR`) : null),
      h('span', { class: 'small muted' }, `${m.rounds_won ?? '?'} – ${m.rounds_lost ?? '?'}`, showAccount && m.riot_id ? ` · ${m.riot_id}` : ''),
      tags.length ? h('span', { class: 'mtags' }, tags) : null),
    h('span', { class: 'mr-agent', 'data-tip': m.agent || null }, agentImg(m.agent_id, 'mr-agent-img', m.agent || '')),
    h('span', { class: 'mr-kda num' }, `${m.kills ?? '–'} / ${m.deaths ?? '–'} / ${m.assists ?? '–'}`),
    h('span', { class: 'mr-hs num small muted' }, hs != null ? `${hs}% HS` : ''),
    h('span', { class: 'mr-tier' }, tierImg(m.tier, 'tier-sm')),
    h('span', { class: 'mr-state' }, state, m.vod_play ? h('span', { class: 'state vod', 'data-tip': 'Your Twitch VOD of this match is available' }, icon('film', 12), 'VOD') : null,
      !m.downloaded ? h('span', { class: 'state wait', 'data-tip': 'The round data is still downloading; opening the match loads it now' }, icon('download', 12)) : null),
    icon('chevRight', 16));
}
