// #/review/<id>: your match (minimap only, your Twitch VOD, a recording or YouTube). #/play/<id>: a pro play.
import { api } from '../api.js';
import { h, put, help, toast, clockS, dateTime, shortDate, ask, local, fill } from '../ui.js';
import { icon } from '../icons.js';
import { mapArt, agentImg } from '../assets.js';
import { roundView } from '../components/roundView.js';
import { notesPanel } from '../components/notes.js';
import { createVideo } from '../components/video.js';
import { KINDS, twitchAvatar } from './pros.js';

export async function render(root, [reviewId]) {
  return open(root, { reviewId: Number(reviewId) });
}
export async function renderPlay(root, [playId, at]) {
  let review;
  try { review = await api.post('/api/reviews', { kind: 'play', play_id: Number(playId) }); }
  catch (err) { fill(root, h('a', { class: 'back', href: '#/pros' }, icon('back', 14), 'Pro review'), h('div', { class: 'empty' }, h('h3', {}, 'This play could not open'), h('p', { class: 'muted' }, err.message))); return; }
  return open(root, { reviewId: review.id, startAt: at && /^\d+$/.test(at) ? Number(at) : null, startRound: at && /^r\d+$/.test(at) ? Number(at.slice(1)) : null });
}

async function open(root, { reviewId, startAt = null, startRound = null }) {
  put(root, h('p', { class: 'muted loading' }, h('i', { class: 'spinner' }), 'Opening the review…'));
  let data;
  try { data = await api.get(`/api/reviews/${reviewId}`); } catch (err) { fill(root, h('div', { class: 'empty' }, h('h3', {}, 'This review could not open'), h('p', { class: 'muted' }, err.message))); return; }
  let { review, notes, play, timing, categories, myVod } = data;
  let d;
  try { d = await api.get(`/api/matches/${review.match_id}?puuid=${encodeURIComponent(review.puuid)}`); }
  catch (err) { fill(root, h('div', { class: 'empty' }, h('h3', {}, 'The match data could not load'), h('p', { class: 'muted' }, err.message))); return; }
  fill(root);

  const isPlay = review.kind === 'play';
  const who = isPlay ? play.player_name : null;
  const cleanups = [];
  let video = null, roundAt = new Map((timing.rounds || []).map((x) => [x.n, x.at]));
  let buyPhase = local.get('jump_buy', false);
  const lead = () => (buyPhase ? 32 : 3);
  const killByKey = new Map(d.rounds.flatMap((r) => r.kills.map((k) => [k.key, { r, k }])));
  const killLabel = (key) => { const x = killByKey.get(key); return x ? `${x.k.killer} → ${x.k.victim}` : null; };

  const art = mapArt(d.map);
  const statusBtn = h('button', { class: review.status === 'done' ? 'is-done' : '' });
  const paintStatus = () => { statusBtn.className = review.status === 'done' ? 'is-done' : ''; fill(statusBtn, icon('check', 14), review.status === 'done' ? 'Reviewed' : isPlay ? 'Mark as reviewed' : 'Finish review'); };
  statusBtn.onclick = async () => {
    if (review.status === 'done') { review = { ...review, ...(await api.patch(`/api/reviews/${review.id}`, { status: 'open' })) }; paintStatus(); toast('Open again'); return; }
    const ratings = isPlay ? undefined : await rateGame(categories, review.ratings);
    if (ratings === false) return;   // closed the dialog
    review = { ...review, ...(await api.patch(`/api/reviews/${review.id}`, { status: 'done', ...(ratings !== undefined ? { ratings } : {}) })) };
    paintStatus(); toast('Marked as reviewed');
  };
  paintStatus();
  const delBtn = h('button', { class: 'quiet icon-btn', 'aria-label': 'Delete this review', 'data-tip': 'Delete this review and its notes', onclick: async () => {
    if (!(await ask(`Delete this review and its ${notes.length} note${notes.length === 1 ? '' : 's'}? This can't be undone.`, { ok: 'Delete', danger: true }))) return;
    await api.del(`/api/reviews/${review.id}`);
    toast('Review deleted');
    location.hash = isPlay ? '#/pros' : '#/reviews';
  } }, icon('trash', 15));
  const nextBtn = isPlay ? h('button', { class: 'primary', 'data-tip': 'Marks this one as reviewed and opens the next play of the same kind (Shift+N)', onclick: async () => {
    if (review.status !== 'done') await api.patch(`/api/reviews/${review.id}`, { status: 'done' });
    const q = new URLSearchParams({ status: 'open', limit: 5, kind: play.kind, sort: 'foryou' });
    const { plays } = await api.get('/api/plays?' + q);
    const next = plays.find((p) => p.id !== play.id);
    if (next) location.hash = `#/play/${next.id}`; else { toast('No more plays of this kind to watch'); location.hash = '#/pros'; }
  } }, 'Next play', icon('chevRight', 14)) : null;
  const meP = d.players.find((p) => p.isMe);
  const k = isPlay ? KINDS[play.kind] || {} : null;
  put(root, h('div', { class: 'rv-bar', style: art && art.splash ? { backgroundImage: `linear-gradient(90deg, rgba(14,14,14,.97), rgba(14,14,14,.86)), url("${art.splash}")` } : null },
    h('a', { class: 'back', href: isPlay ? '#/pros' : `#/match/${review.match_id}/${review.puuid}` }, icon('back', 14), isPlay ? 'Pro review' : 'Match'),
    meP ? agentImg(meP.agentId, 'rv-agent') : null,
    h('div', { class: 'rv-title' },
      isPlay ? h('span', { class: 'kind-tag' }, icon(k.ico || 'play', 12), k.one || play.kind) : h('span', { class: 'kind-tag' }, icon('film', 12), 'VOD review'),
      h('h1', {}, isPlay ? play.label : `${d.map} ${d.score.us}:${d.score.them}`),
      h('span', { class: 'muted small row-i' }, isPlay ? twitchAvatar(play.player_avatar, who, 16) : null, [isPlay ? who : null, meP ? meP.agent : null, d.map, dateTime(d.started_at), isPlay && play.expires ? `VOD until ${shortDate(play.expires)}` : null].filter(Boolean).join(' · '))),
    h('span', { class: 'grow' }), delBtn, statusBtn, nextBtn));

  const sourceBox = h('div', { class: 'source-bar' });
  function paintSources() {
    if (isPlay) { sourceBox.hidden = true; return; }
    const opt = (src, label, ico, tip, disabled = false) => h('button', { class: review.source === src ? 'on' : '', disabled, 'data-tip': tip, onclick: () => pickSource(src) }, icon(ico, 14), label);
    const findBtn = !myVod ? h('button', { class: 'quiet small', 'data-tip': 'Look through your Twitch VODs for this match now', onclick: async () => {
      findBtn.disabled = true; findBtn.classList.add('spin');
      try {
        const r = await api.post('/api/vod/find-match', { match_id: review.match_id, puuid: review.puuid });
        if (r.ok) { myVod = r.play; toast('Found your VOD of this match'); await save({ source: 'twitch', source_ref: String(myVod.id) }); return; }
        toast(r.reason, 'bad');
      } catch (err) { toast(err.message, 'bad'); }
      findBtn.disabled = false; findBtn.classList.remove('spin');
    } }, icon('refresh', 13), 'Find my VOD') : null;
    fill(sourceBox, h('span', { class: 'small muted' }, 'Watch with'),
      h('div', { class: 'seg' },
        opt('none', 'Minimap only', 'map', 'Go round by round on the minimap and take notes, no video'),
        opt('twitch', 'Twitch VOD', 'film', myVod ? 'Your stream of this match' : 'No VOD of yours found for this match yet', !myVod),
        opt('file', 'Recording', 'folder', 'A recording on this PC (OBS, Medal, …)'),
        opt('youtube', 'YouTube', 'link', 'A YouTube upload of this match')),
      findBtn);
  }
  async function pickSource(src) {
    if (src === 'twitch') await save({ source: 'twitch', source_ref: String(myVod.id) });
    else if (src === 'none') await save({ source: 'none', source_ref: null });
    else { review.source = src; review.source_ref = null; paintSources(); paintMain(); }
  }
  async function save(patch) {
    review = { ...review, ...(await api.patch(`/api/reviews/${review.id}`, patch)) };
    await reloadTiming();
    paintSources(); paintMain();
  }
  async function reloadTiming() {
    const fresh = await api.get(`/api/reviews/${review.id}`);
    timing = fresh.timing; review = fresh.review;
    roundAt = new Map((timing.rounds || []).map((x) => [x.n, x.at]));
  }

  const main = h('div', { class: 'rv-main' });
  const below = h('div', { class: 'rv-below' });
  put(root, sourceBox, main, below);

  let rv = null, notesUi = null, follow = null;
  const context = () => ({
    round: rv ? rv.current() : null,
    kill_key: rv ? rv.selected() : null, killLabel: rv && rv.selected() ? killLabel(rv.selected()) : null,
    t: video ? Math.round(video.now() * 10) / 10 : null,
  });
  const seekRound = (n) => { if (video && roundAt.has(n)) video.seek(roundAt.get(n) - lead()); };
  const seekKill = (r, kk) => { if (video && roundAt.has(r.n)) video.seek(roundAt.get(r.n) + kk.t / 1000 - 5); };

  function buildRounds() {
    if (rv) rv.destroy();
    rv = roundView(d, {
      meName: isPlay ? who : null, flags: !isPlay,
      onRound: (n) => seekRound(n),
      onKill: (r, kk) => seekKill(r, kk),
      onAddToNote: async (blob) => { if (!blob || !notesUi) return; await notesUi.insertImage(blob); toast('The map is in your note'); },
      duelExtra: () => h('button', { class: 'quiet small', onclick: () => notesUi && notesUi.focus(), 'data-tip': 'Write a note on this duel (E)' }, icon('pencil', 13), 'Note on this duel'),
    });
    return rv;
  }
  function buildNotes() {
    if (notesUi) notesUi.destroy();
    // only a local recording can give its frame; the Twitch and YouTube players don't allow it
    const snapshot = review.source === 'file' ? () => new Promise((resolve) => {
      const v = video && video.el;
      if (!v || !v.videoWidth) return resolve(null);
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      c.toBlob((b) => resolve(b), 'image/png');
    }) : null;
    notesUi = notesPanel({ review, notes, categories, context, killLabel, snapshot, rounds: d.rounds.map((r) => ({ n: r.n, won: r.won })),
      onChange: (list) => { notes = list; },
      onJump: (n) => {
        if (n.kill_key && killByKey.has(n.kill_key)) rv.selectKill(n.kill_key); else if (n.round) rv.open(n.round);
        if (video && n.t != null) video.seek(n.t - 2);
      } });
    return notesUi;
  }

  function paintMain() {
    if (video) { video.destroy(); video = null; }
    clearInterval(follow);
    fill(main); fill(below);
    buildRounds(); buildNotes();
    if (review.source === 'none') return paintMapOnly();
    if (!review.source_ref) return paintSourceSetup();
    paintVideo();
  }

  function paintMapOnly() {
    const stepper = h('div', { class: 'map-steps' },
      h('button', { class: 'chip', onclick: () => step(-1), 'data-tip': 'Previous round (A)' }, icon('back', 13), 'Round'),
      h('button', { class: 'chip', onclick: () => stepKill(-1), 'data-tip': 'Previous kill (←)' }, icon('back', 13), 'Kill'),
      h('button', { class: 'chip', onclick: () => stepKill(1), 'data-tip': 'Next kill (→)' }, 'Kill', icon('chevRight', 13)),
      h('button', { class: 'chip', onclick: () => step(1), 'data-tip': 'Next round (D)' }, 'Round', icon('chevRight', 13)),
      h('span', { class: 'grow' }),
      h('span', { class: 'small muted' }, 'Step through each round kill by kill; a note goes on the round or the duel you are on.'));
    put(main, h('div', { class: 'rv-grid' }, h('div', { class: 'rv-left' }, h('section', { class: 'card' }, stepper, rv.el)), h('div', { class: 'rv-side' }, notesUi.el)));
    put(below, takeaways());
    rv.open(startRound || firstRound());
  }
  const firstRound = () => (d.rounds.find((r) => r.me && r.me.died) || d.rounds[0] || {}).n || 1;
  const step = (dir) => { const ns = d.rounds.map((r) => r.n), i = ns.indexOf(rv.current() || ns[0]); const n = ns[Math.max(0, Math.min(ns.length - 1, i + dir))]; rv.open(n); seekRound(n); };
  function stepKill(dir) {
    const r = d.rounds.find((x) => x.n === rv.current());
    if (!r) return;
    const ks = r.kills.filter((x) => !x.spike), i = ks.findIndex((x) => x.key === rv.selected());
    const next = i < 0 ? (dir > 0 ? ks[0] : ks[ks.length - 1]) : ks[i + dir];
    if (next) rv.selectKill(next.key); else step(dir);
  }

  async function paintSourceSetup() {
    const box = h('section', { class: 'card source-setup' });
    put(main, box);
    if (review.source === 'youtube') {
      const input = h('input', { placeholder: 'https://www.youtube.com/watch?v=…', 'aria-label': 'YouTube link' });
      box.append(h('h2', {}, 'YouTube'), h('p', { class: 'muted' }, 'Paste the link of your upload (public or unlisted). Then pause the video where round 1 starts once, so the rounds line up.'),
        h('div', { class: 'row' }, input, h('button', { class: 'primary', onclick: async () => { try { await save({ source: 'youtube', source_ref: input.value.trim() }); } catch (err) { toast(err.message, 'bad'); } } }, 'Use this video')));
      return;
    }
    box.append(h('h2', {}, 'Your recording'), h('p', { class: 'muted small' }, 'Loading your recordings folder…'));
    const list = await api.get(`/api/recordings?match=${review.match_id}`).catch((err) => ({ error: err.message, files: [] }));
    fill(box, h('h2', {}, 'Your recording'));
    if (list.error || !list.exists) {
      box.append(h('p', { class: 'muted' }, list.error || (list.root ? `The folder ${list.root} does not exist. Set your recordings folder in Settings.`
        : 'Pick the folder your recordings go to in Settings first. The app only reads that folder.')), h('a', { class: 'btn', href: '#/settings' }, icon('gear', 14), 'Settings'));
      return;
    }
    const matching = new Set((list.matching || []).map((f) => f.rel));
    const guess = new Map((list.matching || []).map((f) => [f.rel, f.offsetGuess]));
    const files = [...(list.matching || []), ...list.files.filter((f) => !matching.has(f.rel)).slice(0, 40)];
    box.append(h('p', { class: 'muted small' }, `From ${list.root}. ${matching.size ? 'The ones recording while this match was played come first.' : 'None of them was recording while this match was played; pick one anyway if it is the right one.'}`),
      files.length ? h('div', { class: 'rec-list' }, files.map((f) => h('button', { class: `rec${matching.has(f.rel) ? ' match' : ''}`, onclick: async () => {
        try { await save({ source: 'file', source_ref: f.rel, offset: guess.has(f.rel) ? guess.get(f.rel) : null }); } catch (err) { toast(err.message, 'bad'); }
      } }, icon('film', 15), h('span', { class: 'rec-main' }, h('b', {}, f.name), h('span', { class: 'small muted' }, `${dateTime(f.start)} – ${new Date(f.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${(f.size / 1e9).toFixed(1)} GB${f.playable ? '' : ' · MKV: may not play, remux to MP4'}`)),
        matching.has(f.rel) ? h('span', { class: 'tag good' }, 'during this match') : null))) : h('p', { class: 'muted' }, 'No videos in that folder.'));
  }

  function paintVideo() {
    const vbox = h('div', { class: 'video' });
    const now = h('span', { class: 'num' }, '0:00');
    const cal = h('div', { class: 'cal', hidden: true });
    const warn = h('div', {});
    const keys = h('div', { class: 'keys', hidden: true }, [['Space', 'play / pause'], ['← →', '5 s back / forward'], ['A D', 'previous / next round'], ['R', 'back to the start of this round'],
      ['E', 'write a note (Ctrl+Enter saves, Esc leaves)'], ['Esc', 'back to the whole round'], isPlay ? ['Shift+N', 'next play'] : null, ['?', 'this list']].filter(Boolean).map(([kk, w]) => h('div', {}, h('kbd', {}, kk), h('span', {}, w))));
    const jumpSeg = h('div', { class: 'seg small', 'data-tip': 'Where a round jumps to: when the barriers drop, or the start of the buy phase' });
    const paintJump = () => fill(jumpSeg, ...[[false, 'Round start'], [true, 'Buy phase']].map(([v, l]) => h('button', { class: buyPhase === v ? 'on' : '', onclick: () => { buyPhase = v; local.set('jump_buy', v); paintJump(); } }, l)));
    paintJump();
    const calBtn = h('button', { class: `chip${timing.delayChecked ? '' : ' warn'}`, onclick: () => { cal.hidden = !cal.hidden; if (!cal.hidden) paintCal(); } }, icon('timer', 13), timing.delayChecked ? 'Timing off?' : 'Line up the rounds');
    const controls = h('div', { class: 'vcontrols' },
      h('button', { class: 'chip', onclick: () => video && video.seek(video.now() - 5) }, '−5 s'),
      h('button', { class: 'chip', onclick: () => video && video.seek(video.now() + 5) }, '+5 s'),
      h('button', { class: 'chip', onclick: () => step(-1), 'data-tip': 'Previous round (A)' }, icon('back', 12), 'Round'),
      h('button', { class: 'chip', onclick: () => step(1), 'data-tip': 'Next round (D)' }, 'Round', icon('chevRight', 12)),
      jumpSeg, calBtn,
      h('span', { class: 'grow' }), h('span', { class: 'small muted' }, 'Now ', now),
      h('button', { class: 'chip', onclick: () => { keys.hidden = !keys.hidden; }, 'aria-label': 'Keyboard shortcuts', 'data-tip': 'Keyboard shortcuts (?)' }, icon('keyboard', 13)));
    const side = h('div', { class: 'rv-side video-side' }, notesUi.el);
    put(main, h('div', { class: 'rv-grid' }, h('div', { class: 'rv-left' }, vbox, controls, keys, cal, warn), side));
    // the notes panel matches the player's height (but keeps room to write beside a small player)
    const ro = new ResizeObserver(() => { side.style.height = window.innerWidth > 1100 ? `${Math.max(vbox.offsetHeight, 520)}px` : ''; });
    ro.observe(vbox);
    cleanups.push(() => ro.disconnect());
    put(below, h('section', { class: 'card rounds-card' }, h('div', { class: 'sec-head' }, h('h2', {}, 'Rounds'), help('A round moves the video to its start (or its buy phase). A kill opens the duel and moves the video to 5 s before it. While the video plays, the rounds follow it.')), rv.el), takeaways());

    const kind = isPlay ? 'twitch' : review.source;
    const ref = isPlay ? play.vod_id : review.source === 'twitch' ? timing.play && timing.play.vod_id : review.source_ref;
    const firstAt = startAt != null ? startAt : startRound && roundAt.has(startRound) ? roundAt.get(startRound) - 3 : isPlay ? play.t : roundAt.has(1) ? Math.max(0, roundAt.get(1) - 3) : 0;
    video = createVideo(kind, vbox, { ref, startAt: firstAt, onError: (err) => fill(warn, h('p', { class: 'small bad' }, icon('warn', 13), ' ', err.message)) });
    rv.open(startRound || (isPlay && play.round) || firstRound());

    if (!roundAt.size) fill(warn, h('p', { class: 'small warn-text' }, icon('info', 13), ' The rounds are not lined up with this video yet. Pause where round 1 starts and use "Line up the rounds".'));
    else if (!timing.delayChecked) fill(warn, h('p', { class: 'small warn-text' }, icon('info', 13), ` ${isPlay ? `${who}'s stream delay` : 'The timing'} is a guess so far, so rounds can land a little early or late. Set it once with "Line up the rounds".`));

    follow = setInterval(() => {
      if (!video) return;
      const t = video.now();
      now.textContent = clockS(t);
      if (video.isPaused() || !cal.hidden || !roundAt.size) return;
      let n = null; for (const [rn, at] of roundAt) if (t >= at - 35) n = rn;
      if (n && n !== rv.current() && !rv.selected()) rv.open(n);
    }, 700);

    let calRound = rv.current() || 1;
    function paintCal() {
      const post = async (body, what) => {
        try {
          const r = await api.post(isPlay ? `/api/plays/${play.id}/calibrate` : `/api/reviews/${review.id}/calibrate`, body);
          await reloadTiming();
          toast(`${what}${r.delay != null ? `: delay ${r.delay} s` : ''}`);
          calBtn.classList.remove('warn'); fill(calBtn, icon('timer', 13), 'Timing off?');
          fill(warn); paintCal();
        } catch (err) { toast(err.message, 'bad'); }
      };
      const pick = h('select', { onchange: (e) => { calRound = Number(e.target.value); } }, d.rounds.map((r) => h('option', { value: r.n, selected: r.n === calRound }, `Round ${r.n}`)));
      const nudge = (s) => h('button', { class: 'chip small', onclick: () => post({ nudge: s }, `Moved ${s > 0 ? '+' : ''}${s} s`) }, `${s > 0 ? '+' : ''}${s} s`);
      const twitchish = isPlay || review.source === 'twitch';
      fill(cal, 
        h('div', { class: 'cal-head' }, h('b', {}, icon('timer', 13), ' Line up the rounds'), twitchish ? h('span', { class: 'small muted' }, `stream delay ${timing.delay} s${timing.delayChecked ? '' : ' (a guess)'}`) : null,
          h('span', { class: 'grow' }), h('button', { class: 'quiet small', onclick: () => { cal.hidden = true; } }, 'Close')),
        h('ol', { class: 'steps small' },
          h('li', {}, 'Pick a round: ', pick, ' ', roundAt.size ? h('button', { class: 'chip small', onclick: () => { rv.open(calRound); if (roundAt.has(calRound)) video.seek(roundAt.get(calRound) - 8); } }, icon('play', 11), 'Go there') : null),
          h('li', {}, 'Pause exactly when the barriers drop (the round clock jumps to ', h('b', {}, '1:40'), '). Drag the playhead if needed.'),
          h('li', {}, h('button', { class: 'primary small', onclick: () => post({ round: calRound, vodTime: video.now() }, `Round ${calRound} lined up`) }, `Round ${calRound} starts here`))),
        roundAt.size ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Or move it:'), nudge(-5), nudge(-1), nudge(1), nudge(5), h('span', { class: 'grow' }),
          h('button', { class: 'quiet small', onclick: async () => { if (await ask('Reset the timing to the default?')) post({ reset: true }, 'Reset'); } }, icon('repeat', 12), 'Reset')) : null,
        twitchish ? h('p', { class: 'small muted' }, `This sets ${isPlay ? `${who}'s` : 'your'} stream delay: every other VOD of the same channel moves with it.`) : null);
    }
  }

  function takeaways() {
    const saved = h('span', { class: 'small muted' });
    const ta = h('textarea', { rows: 4, placeholder: 'Your takeaways: what will you do differently in your next games? One line each.', 'aria-label': 'Takeaways' }, review.summary || '');
    let t = null;
    ta.addEventListener('input', () => { saved.textContent = ''; clearTimeout(t); t = setTimeout(async () => { await api.patch(`/api/reviews/${review.id}`, { summary: ta.value }); saved.textContent = 'Saved'; }, 700); });
    return h('section', { class: 'card takeaways' }, h('div', { class: 'sec-head' }, icon('star', 15), h('h2', {}, 'Takeaways'), h('span', { class: 'grow' }), saved), ta);
  }

  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-wrap')) return;
    const kk = e.key.length === 1 && e.key !== 'N' ? e.key.toLowerCase() : e.key;
    const act = {
      ' ': () => video && video.toggle(),
      ArrowLeft: () => (video ? video.seek(video.now() - 5) : stepKill(-1)), ArrowRight: () => (video ? video.seek(video.now() + 5) : stepKill(1)),
      a: () => step(-1), d: () => step(1), ',': () => step(-1), '.': () => step(1),
      r: () => { if (rv.current()) { rv.open(rv.current()); seekRound(rv.current()); } },
      e: () => notesUi && notesUi.focus(),
      N: () => e.shiftKey && nextBtn && nextBtn.click(),
      '?': () => { const kb = main.querySelector('.keys'); if (kb) kb.hidden = !kb.hidden; },
    }[kk];
    if (!act) return;
    e.preventDefault();
    act();
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  paintSources();
  paintMain();
  return () => { cleanups.forEach((f) => f()); clearInterval(follow); if (video) video.destroy(); if (rv) rv.destroy(); if (notesUi) notesUi.destroy(); };
}

// → { focus: 1..5 } for the rated ones, null when skipped, false when closed without finishing
const SCALE = ['', 'Bad', 'Weak', 'OK', 'Good', 'Great'];
function rateGame(categories, current = null) {
  return new Promise((resolve) => {
    const picked = { ...(current || {}) };
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const rows = categories.map((c) => {
      const row = h('div', { class: 'rate-row' }, h('span', { class: 'rate-cat' }, c));
      const btns = h('div', { class: 'rate-btns', role: 'radiogroup', 'aria-label': c });
      const paint = () => fill(btns, ...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: `rate r${n}${picked[c] === n ? ' on' : ''}`, role: 'radio', 'aria-checked': String(picked[c] === n), 'data-tip': SCALE[n],
        onclick: () => { if (picked[c] === n) delete picked[c]; else picked[c] = n; paint(); } }, n)));
      paint();
      row.append(btns);
      return row;
    });
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(false); } },
      h('div', { class: 'modal rate-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rate this game' },
        h('h2', {}, 'How did this game go?'),
        h('p', { class: 'muted small' }, 'Rate each focus from 1 (bad) to 5 (great), only the ones you want. The Reviews page shows how your ratings change over time.'),
        h('div', { class: 'rate-rows' }, rows),
        h('div', { class: 'row end' },
          h('button', { class: 'quiet', onclick: () => close(null) }, 'Skip rating'),
          h('button', { class: 'primary', onclick: () => close(Object.keys(picked).length ? picked : null) }, icon('check', 14), 'Finish review'))));
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.rate')?.focus();
  });
}
