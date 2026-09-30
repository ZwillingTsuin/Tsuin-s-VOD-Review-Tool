import { h, put, clockMs, fill, nameTag, says, toast } from '../ui.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { agentIcon, agentImg, weaponIcon } from '../assets.js';
import { minimap, calloutToggle } from './minimap.js';

export const FLAGS = {
  'early': { label: 'Early death', warn: true, tip: 'Died in the first 20 s of the round', ico: 'timer' },
  'first-death': { label: 'First death', warn: true, tip: 'The round\'s opening kill was on you', ico: 'door' },
  'not-traded': { label: 'Not traded', warn: true, tip: 'No teammate killed your killer within 5 s', ico: 'alone' },
  'no-damage': { label: 'No damage', warn: true, tip: 'You did no damage to the player who killed you', ico: 'x' },
  'man-advantage': { label: 'Died up a player', warn: true, tip: 'Your team had more players alive when you died', ico: 'scale' },
  'lost-to-eco': { label: 'Lost to an eco', warn: true, tip: 'You were full-bought, they were on an eco', ico: 'coin' },
  'traded-back': { label: 'Died right after', warn: true, tip: 'You died within 5 s of getting this kill', ico: 'repeat' },
  'first-blood': { label: 'First blood', warn: false, tip: 'The round\'s opening kill', ico: 'drop' },
  'traded-teammate': { label: 'Traded a teammate', warn: false, tip: 'You killed the enemy who had just killed a teammate', ico: 'users' },
};
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function roundView(d, opts = {}) {
  const you = opts.meName || 'you';
  const byP = new Map(d.players.map((p) => [p.puuid, p]));
  const myTeam = d.me ? d.me.team : null, myP = d.me ? d.me.puuid : null;
  const rel = (team) => (myTeam ? (team === myTeam ? 'ally' : 'enemy') : team === 'Red' ? 'enemy' : 'ally');
  const img = (pz) => { const p = byP.get(pz); return p && p.agentId ? agentIcon(p.agentId) : null; };
  const duelOf = new Map((d.duels || []).map((x) => [x.key, x]));

  const el = h('div', { class: 'rounds' });
  const flagsEl = h('div', { class: 'flag-bar' });
  const left = h('div', { class: 'round-left' });
  const map = d.minimap ? minimap({ src: d.minimap, callouts: d.callouts, cls: 'round-map' }) : null;
  const mapHead = h('div', { class: 'map-head' });
  const legend = h('div', { class: 'map-legend' });
  let cur = null, selKey = null, flag = null;
  const strip = roundStrip(d, (r) => { flag = null; paintFlags(); showRound(r); if (opts.onRound) opts.onRound(r.n); });

  // saved a second after the last stroke
  const drawings = {};
  let drawRound = null, saveTimer = null;
  const drawKey = d.match_id && d.me ? { match_id: d.match_id, puuid: d.me.puuid } : null;
  const saveDrawing = (n, strokes) => {
    drawings[n] = strokes;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.put('/api/drawings', { ...drawKey, round: n, strokes }).catch((err) => toast(`The drawing was not saved: ${err.message}`, 'bad')), 800);
  };
  if (map && drawKey) {
    map.drawing.enable({
      onChange: (strokes) => { if (drawRound != null) saveDrawing(drawRound, strokes); },
      onAddToNote: opts.onAddToNote ? async () => opts.onAddToNote(await map.snapshot({ extra: paintMarks }), cur ? cur.n : null) : null,
    });
    api.get(`/api/drawings?match=${encodeURIComponent(d.match_id)}&puuid=${encodeURIComponent(d.me.puuid)}`).then((all) => {
      Object.assign(drawings, all);
      if (drawRound != null && !map.drawing.strokes().length) map.drawing.set(drawings[drawRound]);
    }).catch(() => {});
  }
  const showDrawing = (n) => { if (!map || !drawKey) return; drawRound = n; map.drawing.lock(n == null); map.drawing.set(n == null ? [] : drawings[n]); };
  function paintMarks(ctx, toPx, scale) {
    const r = cur;
    if (!r) return;
    const col = { ally: '#3ecfa6', enemy: '#ff4655', me: '#f2b33d' };
    for (const k of r.kills) {
      if (!k.vUV || k.spike) continue;
      const [x, y] = toPx([k.vUV[0] * 1000, k.vUV[1] * 1000]), s2 = 8 * scale;
      ctx.strokeStyle = k.victimPuuid === myP ? col.me : col[rel(k.victimTeam)]; ctx.lineWidth = 3 * scale;
      ctx.beginPath(); ctx.moveTo(x - s2, y - s2); ctx.lineTo(x + s2, y + s2); ctx.moveTo(x + s2, y - s2); ctx.lineTo(x - s2, y + s2); ctx.stroke();
    }
    if (r.plant && r.plant.uv) {
      const [x, y] = toPx([r.plant.uv[0] * 1000, r.plant.uv[1] * 1000]);
      ctx.fillStyle = '#c3202f'; ctx.beginPath(); ctx.arc(x, y, 12 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${13 * scale}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(r.plant.site || '', x, y + 4.5 * scale);
    }
  }
  put(el, flagsEl, strip, h('div', { class: `round-grid${map ? '' : ' no-map'}` }, left, map ? h('div', { class: 'map-col' }, mapHead, map.el, legend) : null));

  function who(pz, name, team) {
    return h('span', { class: `kp ${rel(team)}${pz === myP ? ' me' : ''}` }, agentImg((byP.get(pz) || {}).agentId, 'kp-img'), h('span', { class: 'kn' }, name || '?'));
  }
  function weapon(k) {
    const src = weaponIcon(k.weaponId);
    if (!src) return h('span', { class: 'kw txt', 'data-tip': k.weapon }, k.spike ? icon('bomb', 14) : k.weapon);
    const im = h('img', { src, alt: k.weapon, class: 'kw-img', 'data-tip': k.weapon });
    im.onerror = () => im.replaceWith(document.createTextNode(k.weapon));
    return h('span', { class: 'kw' }, im);
  }
  function feed(r, sel = null) {
    return h('ul', { class: 'killfeed' }, r.kills.map((k) => h('li', {
      class: `${k.mine ? `mine ${k.mine}` : ''}${sel && k.key === sel ? ' sel' : ''}${k.spike ? ' spike' : ''}`,
      onclick: k.spike ? null : () => selectKill(k.key), tabindex: k.spike ? null : '0',
      onkeydown: (e) => { if (e.key === 'Enter' && !k.spike) selectKill(k.key); },
    },
    h('span', { class: 'kt num' }, clockMs(k.t)),
    who(k.killerPuuid, k.killer, k.killerTeam), weapon(k), who(k.victimPuuid, k.victim, k.victimTeam),
    h('span', { class: 'ktags' }, k.first ? h('span', { class: 'kt-first', 'data-tip': 'First kill of the round' }, 'FIRST') : null))));
  }
  function roundHead(r) {
    const me = r.me || {};
    return h('div', { class: 'rd-head' },
      h('b', {}, `Round ${r.n}`),
      r.won != null ? h('span', { class: `res ${r.won ? 'w' : 'l'}` }, r.won ? 'Won' : 'Lost') : null,
      h('span', { class: 'muted small' }, [r.side === 'attack' ? 'Attack' : r.side === 'defense' ? 'Defense' : null, r.result].filter(Boolean).join(' · ')),
      r.plant ? h('span', { class: 'muted small row-i' }, icon('bomb', 13), `${r.plant.site} at ${clockMs(r.plant.t)}${r.plant.byMe ? ` (${you})` : ''}`) : null,
      me.weapon ? h('span', { class: 'muted small rd-me' }, [me.weapon, me.armor ? me.armor.replace(' Armor', '') : null, me.loadout != null ? `${me.loadout} cr` : null, me.damage != null ? `${me.damage} dmg` : null].filter(Boolean).join(' · ')) : null);
  }

  function showRound(r) {
    cur = r; selKey = null;
    strip.querySelectorAll('.rchip').forEach((c) => c.classList.toggle('on', c.dataset.n === String(r.n)));
    fill(left, roundHead(r), feed(r), opts.roundExtra ? opts.roundExtra(r) : null);
    paintRound(r);
  }

  function duelCard(r, k) {
    const f = k.facts || {};
    const iAmKiller = k.killerPuuid === myP, iAmVictim = k.victimPuuid === myP, mineDuel = iAmKiller || iAmVictim;
    const kName = nameTag(k.killer, iAmKiller ? 'me' : rel(k.killerTeam)), vName = nameTag(k.victim, iAmVictim ? 'me' : rel(k.victimTeam));
    const title = iAmKiller ? says('You killed ', [k.victim, rel(k.victimTeam)]) : iAmVictim ? [kName, ' killed you'] : [kName, ' killed ', vName];
    const oppP = iAmKiller ? k.victimPuuid : k.killerPuuid;
    const alive = iAmVictim ? `${f.alive.victimTeam} v ${f.alive.killerTeam}` : `${f.alive.killerTeam} v ${f.alive.victimTeam}`;
    const duel = duelOf.get(k.key), flags = duel ? duel.flags : [];
    const has = (x) => flags.includes(x);
    // tone: 'warn' | 'good' | ''
    const fact = (label, value, tone = '') => h('div', { class: `fact ${tone === true ? 'warn' : tone || ''}` }, h('small', {}, label), h('b', {}, value));
    const hits = (x) => [h('span', {}, `${x.damage} damage`), x.head || x.body || x.leg ? h('span', { class: 'hitsplit' }, `${x.head} head · ${x.body} body · ${x.leg} leg`) : null];
    const tradedBy = () => (f.tradedBy ? [h('span', { class: 'yes' }, 'Yes'), ' by ', nameTag(f.tradedBy, iAmVictim ? 'ally' : rel(k.victimTeam)), ` after ${secs(f.tradedAfterMs)}`] : h('span', { class: 'no' }, 'No'));
    const facts = [
      fact('Time into round', secs(k.t), has('early')),
      fact('Players alive', alive, has('man-advantage')),
      fact('Weapons', iAmVictim ? `${f.victimWeapon || '?'} vs ${f.killerWeapon}` : `${f.killerWeapon} vs ${f.victimWeapon || '?'}`),
      fact('Loadouts', iAmVictim ? `${f.victimLoadout} vs ${f.killerLoadout}` : `${f.killerLoadout} vs ${f.victimLoadout}`, has('lost-to-eco')),
      f.dist != null ? fact('Distance', `~${f.dist} m`) : null,
    ];
    if (iAmKiller) {
      facts.push(fact('Your damage on them', hits(f.onVictim)),
        fact('After the kill', f.killerDiedAfterMs != null ? [h('span', { class: 'no' }, 'Died'), ` ${secs(f.killerDiedAfterMs)} later`] : h('span', { class: 'yes' }, 'Survived'), has('traded-back')));
      if (f.tradeOf) facts.push(fact('This kill traded', nameTag(f.tradeOf, 'ally'), 'good'));
    } else if (iAmVictim) facts.push(fact('Your damage on them', hits(f.onKiller), has('no-damage')), fact('Your death traded', tradedBy(), has('not-traded')));
    else facts.push(fact([vName, ' on ', kName], hits(f.onKiller)), fact([kName, ' on ', vName], hits(f.onVictim)), fact('Traded', tradedBy()));
    if (k.vLook && k.vLook.off != null) facts.push(fact(iAmVictim ? 'Where you looked' : ['Where ', vName, ' looked'], k.vLook.off > 60 ? `${k.vLook.off}° away from the killer, ${(k.vLook.dt / 1000).toFixed(1)} s before` : 'Towards the killer', k.vLook.off > 60));
    return h('div', { class: 'duel-card' },
      h('div', { class: 'duel-top' },
        h('button', { class: 'quiet small', onclick: () => showRound(r), 'data-tip': 'Back to the whole round (Esc)' }, icon('back', 13), `Round ${r.n}`),
        opts.duelExtra ? opts.duelExtra(r, k) : null),
      h('div', { class: 'duel-head' }, agentImg((byP.get(mineDuel ? oppP : k.killerPuuid) || {}).agentId, 'duel-agent'),
        h('div', {}, h('h3', {}, title), h('p', { class: 'muted small' }, [`Round ${r.n}`, r.side === 'attack' ? 'Attack' : r.side === 'defense' ? 'Defense' : null, `${clockMs(k.t)} into the round`, r.won != null ? `round ${r.won ? 'won' : 'lost'}` : null].filter(Boolean).join(' · ')))),
      flags.length ? h('div', { class: 'duel-flags' }, flags.map((x) => FLAGS[x] ? h('span', { class: `flag${FLAGS[x].warn ? ' warn' : ''}`, 'data-tip': FLAGS[x].tip }, icon(FLAGS[x].ico, 11), FLAGS[x].label) : null)) : null,
      h('div', { class: 'facts' }, facts),
      feed(r, k.key));
  }

  function selectKill(key) {
    let r = cur, k = r && r.kills.find((x) => x.key === key);
    if (!k) { r = d.rounds.find((x) => x.kills.some((y) => y.key === key)); k = r && r.kills.find((x) => x.key === key); }
    if (!k || k.spike) return;
    if (r !== cur) { cur = r; strip.querySelectorAll('.rchip').forEach((c) => c.classList.toggle('on', c.dataset.n === String(r.n))); }
    selKey = key;
    fill(left, duelCard(r, k));
    paintRound(r, k);
    if (opts.onKill) opts.onKill(r, k);
  }

  // with a kill picked: that moment (everyone alive and where they looked), zoomed onto the duel
  function paintRound(r, sel = null) {
    if (!map) return;
    map.clear();
    if (drawRound !== r.n) showDrawing(r.n);
    fill(mapHead, h('b', {}, sel ? `R${r.n} ${clockMs(sel.t)}  ${sel.killer} → ${sel.victim}` : `Round ${r.n}`), h('span', { class: 'grow' }), calloutToggle(map));
    if (r.plant && r.plant.uv) map.spike(r.plant.uv, { text: r.plant.site, tip: `Spike planted on ${r.plant.site} at ${clockMs(r.plant.t)}${r.plant.by ? ` by ${r.plant.by}` : ''}` });
    const upTo = sel ? r.kills.indexOf(sel) : r.kills.length - 1;
    r.kills.forEach((k, i) => {
      if (!k.vUV || k.spike) return;
      const later = i > upTo, isMe = k.victimPuuid === myP, other = sel && k !== sel;
      const layer = isMe && !other ? map.top : later || other ? map.base : map.mid;
      map.cross(k.vUV, { layer, cls: `${rel(k.victimTeam)}${isMe ? ' me' : ''}${later ? ' later' : ''}${other ? ' faded' : ''}`, tip: `${k.victim} died at ${clockMs(k.t)}${k.vCall ? ` · ${k.vCall}` : ''} · ${k.killer} with ${k.weapon}`, onclick: () => selectKill(k.key) });
      if (!sel) map.text(k.vUV, String(i + 1), { cls: `order ${rel(k.victimTeam)}${isMe ? ' me' : ''}`, dy: -20, layer: isMe ? map.top : map.mid });
    });
    if (sel) {
      for (const p of sel.pos || []) {
        if (p.p === sel.killerPuuid || p.p === sel.victimPuuid) continue;
        map.agent(p.uv, { layer: map.mid, img: img(p.p), cls: `${rel(p.team)}${p.p === myP ? ' me' : ''} alive`, r: 16, facing: p.f, tip: (byP.get(p.p) || {}).name || '?' });
      }
      const lk = sel.vLook;
      if (lk && lk.uv && lk.f) map.agent(lk.uv, { layer: map.mid, cls: `${rel(sel.victimTeam)} ghost`, r: 10, facing: lk.f, tip: `${sel.victim} ${(lk.dt / 1000).toFixed(1)} s before: looking ${lk.off > 60 ? `${lk.off}° away from the killer` : 'towards the killer'}` });
      map.line(sel.kUV, sel.vUV, { cls: 'shot', layer: map.top });
      const kp = (sel.pos || []).find((p) => p.p === sel.killerPuuid);
      map.agent(sel.kUV, { img: img(sel.killerPuuid), cls: `${rel(sel.killerTeam)} killer${sel.killerPuuid === myP ? ' me' : ''}`, r: 22, facing: kp && kp.f, tip: `${sel.killer}${sel.kCall ? ` at ${sel.kCall}` : ''}` });
      map.agent(sel.vUV, { img: img(sel.victimPuuid), cls: `${rel(sel.victimTeam)} victim${sel.victimPuuid === myP ? ' me' : ''}`, r: 22, tip: `${sel.victim}${sel.vCall ? ` at ${sel.vCall}` : ''}` });
      map.fit([sel.kUV, sel.vUV, lk && lk.uv]);
    } else {
      const mine = r.kills.find((k) => k.victimPuuid === myP && !k.spike);
      if (mine && mine.kUV) {
        map.line(mine.kUV, mine.vUV, { cls: 'shot mine', layer: map.top });
        map.agent(mine.kUV, { img: img(mine.killerPuuid), cls: 'enemy killer', r: 19, tip: `${mine.killer} killed ${you} from here${mine.kCall ? ` (${mine.kCall})` : ''}`, onclick: () => selectKill(mine.key) });
      }
      map.reset();
    }
    fill(legend, 
      h('span', {}, h('i', { class: 'lg x ally' }), opts.meName ? `${you}'s team` : 'your team'), h('span', {}, h('i', { class: 'lg x enemy' }), 'enemy'),
      myP ? h('span', {}, h('i', { class: 'lg x me' }), you) : null,
      sel && sel.vLook ? h('span', {}, h('i', { class: 'lg ghost' }), 'victim\'s view shortly before') : null,
      h('span', { class: 'muted' }, 'click a kill for the duel · scroll to zoom'));
  }

  function paintFlags() {
    fill(flagsEl);
    if (opts.flags === false || !d.duels || !d.duels.length) return;
    const counts = Object.entries(FLAGS).filter(([, f]) => f.warn).map(([key, f]) => [key, f, d.duels.filter((x) => x.flags.includes(key))]).filter(([, , l]) => l.length);
    if (!counts.length) return;
    put(flagsEl, h('span', { class: 'muted small' }, 'The data shows'),
      counts.map(([key, f, l]) => h('button', { class: `chip warn${flag === key ? ' on' : ''}`, 'data-tip': `${f.tip}. Click to see them on the map.`,
        onclick: () => { flag = flag === key ? null : key; paintFlags(); if (flag) showFlag(key); else if (cur) showRound(cur); } }, icon(f.ico, 13), f.label, h('span', { class: 'n' }, l.length))));
  }
  function showFlag(key) {
    const list = d.duels.filter((x) => x.flags.includes(key));
    strip.querySelectorAll('.rchip').forEach((c) => c.classList.remove('on'));
    const find = (x) => { const r = d.rounds.find((y) => y.n === x.round); return [r, r && r.kills.find((k) => k.key === x.key)]; };
    fill(left, h('div', { class: 'rd-head' }, icon(FLAGS[key].ico, 15), h('b', {}, `${FLAGS[key].label}: ${list.length}×`), h('span', { class: 'muted small' }, FLAGS[key].tip)),
      h('ul', { class: 'flag-list' }, list.map((x) => { const [r, k] = find(x); return r && k ? h('li', { onclick: () => { flag = null; paintFlags(); selectKill(k.key); }, tabindex: '0' },
        h('b', { class: 'num' }, `R${r.n}`), h('span', { class: 'muted small num' }, clockMs(k.t)), h('span', {}, x.kind === 'kill' ? says('You killed ', [k.victim, 'enemy']) : says([k.killer, 'enemy'], ' killed you')), h('span', { class: 'muted small' }, k.weapon), icon('chevRight', 13)) : null; })));
    if (!map) return;
    map.clear();
    showDrawing(null);   // several rounds at once: nothing to draw on
    fill(mapHead, h('b', {}, `${FLAGS[key].label}: ${list.length}×`), h('span', { class: 'grow' }), calloutToggle(map));
    for (const x of list) {
      const [r, k] = find(x);
      if (!k || !k.vUV) continue;
      map.line(k.kUV, k.vUV, { cls: x.kind === 'death' ? 'shot mine' : 'shot', layer: map.mid });
      map.cross(k.vUV, { cls: x.kind === 'death' ? 'ally me' : 'enemy', layer: map.top, tip: `Round ${r.n}, ${clockMs(k.t)}: ${k.killer} → ${k.victim}. Click for the duel.`, onclick: () => { flag = null; paintFlags(); selectKill(k.key); } });
      map.text(k.vUV, `R${r.n}`, { cls: 'order me', dy: -22 });
    }
    map.reset();
  }

  const onKey = (e) => {
    if (e.key === 'Escape' && selKey && cur && !e.target.closest('input, textarea, select')) showRound(cur);
  };
  document.addEventListener('keydown', onKey);
  paintFlags();
  return {
    el, strip,
    open: (n) => { const r = d.rounds.find((x) => x.n === n); if (r && (!cur || cur.n !== n || selKey)) { flag = null; paintFlags(); showRound(r); } },
    selectKill, current: () => (cur ? cur.n : null), selected: () => selKey,
    refresh: () => { if (cur) { if (selKey) selectKill(selKey); else showRound(cur); } },
    destroy: () => document.removeEventListener('keydown', onKey),
  };
}

// the side is written only where it changes (start, half, every overtime round)
export function roundStrip(d, onPick) {
  const wrap = h('div', { class: 'strip-wrap' });
  const el = h('div', { class: 'round-strip', role: 'tablist', 'aria-label': 'Rounds' });
  const ecoOf = new Map((d.teamEconomy ? d.teamEconomy.rounds : []).map((e) => [e.n, e]));
  const sideTag = (side) => h('span', { class: `side-tag ${side}`, 'data-tip': side === 'attack' ? 'Your team attacks these rounds' : 'Your team defends these rounds' }, icon(side === 'attack' ? 'sword' : 'shield', 12), side === 'attack' ? 'ATK' : 'DEF');
  d.rounds.forEach((r, i) => {
    const prev = d.rounds[i - 1];
    if (r.side && (!prev || prev.side !== r.side)) el.append(sideTag(r.side));
    const me = r.me || {}, e = ecoOf.get(r.n);
    const buy = e && i !== 0 && i !== 12 && e.us.cls !== 'full' ? e.us.cls : null;
    const tip = [`Round ${r.n}: ${r.won == null ? '' : r.won ? 'won' : 'lost'} (${r.result})`, me.kills ? `${me.kills} kill${me.kills > 1 ? 's' : ''}` : null, me.died ? 'died' : null,
      e && i !== 0 && i !== 12 ? `buys: ${e.us.cls} vs ${e.them.cls}` : i === 0 || i === 12 ? 'pistol round' : null].filter(Boolean).join(' · ');
    el.append(h('button', { class: `rchip ${r.won == null ? '' : r.won ? 'won' : 'lost'}`, dataset: { n: r.n }, role: 'tab', 'data-tip': tip, onclick: () => onPick(r) },
      h('span', { class: 'rn num' }, r.n),
      h('span', { class: 'rk' }, me.kills ? '•'.repeat(Math.min(me.kills, 5)) : ''),
      me.died ? h('span', { class: 'rd' }, icon('skull', 11)) : h('span', { class: 'rd' }),
      buy ? h('span', { class: `reco ${buy}` }, buy === 'eco' ? 'E' : 'H') : null));
  });
  wrap.append(el, h('div', { class: 'strip-legend small muted' },
    h('span', {}, h('i', { class: 'lg-bar won' }), 'won'), h('span', {}, h('i', { class: 'lg-bar lost' }), 'lost'),
    h('span', {}, h('b', { class: 'lg-dots' }, '••'), 'your kills'), h('span', {}, icon('skull', 11), 'you died'),
    h('span', {}, h('b', { class: 'lg-eco' }, 'H'), h('b', { class: 'lg-eco' }, 'E'), 'your team on a half buy / eco')));
  return wrap;
}

