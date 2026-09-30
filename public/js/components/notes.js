// context() → { round, kill_key, killLabel, t }: where a new note goes by default
import { h, put, clockS, local, ask, toast, fill } from '../ui.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { editor, renderRich } from './editor.js';

const noteLabel = (n) => {
  const rs = roundsOf(n);
  return [rs.length ? rs.map((x) => `R${x}`).join(', ') : 'Whole game', n.t != null && rs.length === 1 ? clockS(n.t) : null].filter(Boolean).join(' · ');
};
const byPlace = (a, b) => (a.round || 0) - (b.round || 0) || (a.t ?? 0) - (b.t ?? 0) || a.id - b.id;

export function notesPanel({ review, notes: start, categories, context, onJump, onChange, killLabel = () => null, snapshot = null, rounds = [] }) {
  let notes = start.slice();
  let cat = local.get('note_cat', categories[0]);
  if (!categories.includes(cat)) cat = categories[0];
  const el = h('div', { class: 'notes card' });
  const cats = h('div', { class: 'note-cats' });
  const ed = editor({ placeholder: 'What happened, and what would you do instead? Paste screenshots with Ctrl+V. (Ctrl+Enter saves)', draftKey: `note_draft_${review.id}`, onSubmit: () => add(), snapshot,
    expandInfo: () => `${cat} · saved to ${whereText()}`,
    expandActions: () => [lessonToggle(), h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: () => add() }, icon('plus', 14), 'Add note')] });
  const LESSON_TIP = 'Mark this note as a key lesson: it is also collected on the Reviews page under "Lessons", so the takeaways you want to remember don\'t get lost among all your notes.';
  const star = h('button', { class: 'quiet star-btn lesson-btn', type: 'button', 'data-tip': LESSON_TIP, 'aria-pressed': 'false' });
  const paintStar = (b) => { const on = star.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.replaceChildren(icon('star', 14), h('span', {}, on ? 'Key lesson ✓' : 'Key lesson')); };
  const stars = new Set([star]);
  const toggleStar = () => { star.classList.toggle('on'); stars.forEach(paintStar); };
  star.onclick = toggleStar;
  function lessonToggle() {
    const b = h('button', { class: 'quiet star-btn lesson-btn', type: 'button', 'data-tip': LESSON_TIP, onclick: toggleStar });
    stars.add(b); paintStar(b);
    return b;
  }
  paintStar(star);
  const addBtn = h('button', { class: 'primary', onclick: () => add() }, icon('plus', 14), 'Add note');
  const list = h('div', { class: 'note-list' });
  const count = h('span', { class: 'n' });

  let editing = false;
  const paintCats = () => {
    if (!editing) {
      fill(cats, ...categories.map((c) => h('button', { class: `chip small${c === cat ? ' on' : ''}`, type: 'button', onclick: () => { cat = c; local.set('note_cat', c); paintCats(); ed.focus(); } }, c)),
        h('button', { class: 'chip small ghost', type: 'button', 'data-tip': 'Add, rename or remove focuses', 'aria-label': 'Edit focuses', onclick: () => { editing = true; paintCats(); } }, icon('pencil', 11)));
      return;
    }
    const list2 = categories.slice();
    const box = h('div', { class: 'focus-edit' });
    const input = h('input', { placeholder: 'New focus, e.g. Crosshair placement', maxlength: 40, 'aria-label': 'New focus' });
    const paintList = () => fill(box, ...list2.map((c, i) => h('span', { class: 'chip small focus-chip' }, c,
      h('button', { class: 'x', type: 'button', 'aria-label': `Remove ${c}`, onclick: () => { list2.splice(i, 1); paintList(); } }, icon('x', 10)))));
    const addFocus = () => { const v = input.value.trim(); if (v && !list2.includes(v)) list2.push(v); input.value = ''; paintList(); input.focus(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFocus(); } });
    paintList();
    fill(cats, h('div', { class: 'focus-editor' }, h('small', { class: 'muted' }, 'Your focuses (used in every review)'), box,
      h('div', { class: 'row' }, input, h('button', { class: 'small', type: 'button', onclick: addFocus }, icon('plus', 12), 'Add')),
      h('div', { class: 'row end' },
        h('button', { class: 'quiet small', type: 'button', onclick: () => { editing = false; paintCats(); } }, 'Cancel'),
        h('button', { class: 'primary small', type: 'button', onclick: async () => {
          if (!list2.length) { toast('Keep at least one focus', 'bad'); return; }
          try { await api.patch('/api/settings', { categories: list2 }); } catch (err) { toast(err.message, 'bad'); return; }
          categories.splice(0, categories.length, ...list2);
          if (!categories.includes(cat)) cat = categories[0];
          editing = false; paintCats();
        } }, 'Save'))));
    input.focus();
  };
  const autoText = () => {
    const c = context();
    return [c.round ? `Round ${c.round}` : null, c.kill_key ? (c.killLabel || 'this duel') : null, c.t != null ? clockS(c.t) : null].filter(Boolean).join(' · ') || 'the whole game';
  };
  // 'auto' follows what you look at, 'game' = whole game, 'pick' = picked rounds; back to 'auto' after each note
  let scope = { mode: 'auto', picked: new Set() };
  const scopeText = (sc = scope, auto = autoText) => (sc.mode === 'game' ? 'the whole game' : sc.mode === 'pick' ? (sc.picked.size ? `${sc.picked.size === 1 ? 'Round' : 'Rounds'} ${[...sc.picked].sort((a, b) => a - b).join(', ')}` : 'no round picked yet') : auto());
  const whereText = () => scopeText();
  const where = h('button', { class: 'scope-btn small', type: 'button', 'data-tip': 'Where this note is saved: the round you are on (the default), several rounds, or the whole game. Click to change.',
    onclick: () => openScope(where, scope, { rounds, allowAuto: true, autoText }, (sc) => { scope = sc; paintWhere(); }) });
  const paintWhere = () => { fill(where, icon(scope.mode === 'game' ? 'film' : scope.mode === 'pick' ? 'grid' : 'mapPin', 12), h('span', {}, `Saved to ${scopeText()}`), icon('chevDown', 11)); where.classList.toggle('set', scope.mode !== 'auto'); };

  // which notes the list shows: the round you are on (the default), whole-game notes, or all
  let filter = 'round';
  const curRound = () => context().round || null;
  const inRound = (n, r) => !!r && roundsOf(n).includes(r);
  const shows = (n, f = filter, r = curRound()) => (f === 'all' ? true : f === 'game' ? !roundsOf(n).length : inRound(n, r));
  const filterBar = h('div', { class: 'note-filter', role: 'tablist', 'aria-label': 'Which notes to show' });
  function paintFilter() {
    const r = curRound();
    const opt = (f, label) => h('button', { type: 'button', role: 'tab', class: filter === f ? 'on' : '', 'aria-selected': String(filter === f),
      onclick: () => { filter = f; paint(); } }, label, h('span', { class: 'n' }, notes.filter((n) => shows(n, f, r)).length));
    fill(filterBar, opt('round', r ? `Round ${r}` : 'This round'), opt('game', 'Whole game'), opt('all', 'All'));
  }

  let saving = false;
  async function add() {
    if (saving) return;
    if (ed.isEmpty()) { ed.focus(); return; }
    if (scope.mode === 'pick' && !scope.picked.size) { toast('Pick at least one round, or save it to the whole game', 'bad'); return; }
    const c = context();
    const where2 = scope.mode === 'game' ? { rounds: [] } : scope.mode === 'pick' ? { rounds: [...scope.picked] } : { round: c.round ?? null, kill_key: c.kill_key ?? null, t: c.t ?? null };
    saving = true; addBtn.disabled = true;
    try {
      const note = await api.post('/api/notes', { review_id: review.id, ...where2, category: cat, body: ed.html(), starred: star.classList.contains('on') });
      notes.push(note);
      ed.clear(); star.classList.remove('on'); stars.forEach(paintStar);
      scope = { mode: 'auto', picked: new Set() }; paintWhere();
      if (ed.isBig()) ed.collapse();
      paint(); onChange && onChange(notes);
      if (!shows(note)) toast(`Saved to ${noteLabel(note)}. It shows under "${roundsOf(note).length ? 'All' : 'Whole game'}".`);
    } catch (err) { toast(`Not saved: ${err.message}. Your text is still here.`, 'bad'); }
    finally { saving = false; addBtn.disabled = false; }
  }

  function item(n) {
    const rs = roundsOf(n);
    const row = h('div', { class: `note${n.starred ? ' starred' : ''}`, dataset: { rounds: rs.join(',') } });
    const kl = n.kill_key ? killLabel(n.kill_key) : null;
    const view = () => fill(row,
      h('div', { class: 'note-head' },
        jumpBtn(n), h('span', { class: 'note-cat' }, n.category), kl ? h('span', { class: 'muted small' }, kl) : null,
        h('span', { class: 'grow' }),
        h('button', { class: `quiet icon-btn star-btn${n.starred ? ' on' : ''}`, 'aria-label': n.starred ? 'Remove from key lessons' : 'Mark as a key lesson', 'data-tip': n.starred ? 'A key lesson (collected on the Reviews page). Click to remove it from the lessons.' : 'Mark as a key lesson: collected on the Reviews page under Lessons',
          onclick: async () => { Object.assign(n, await api.patch(`/api/notes/${n.id}`, { starred: !n.starred })); paint(); } }, icon('star', 13)),
        h('button', { class: 'quiet icon-btn', 'aria-label': 'Full screen', 'data-tip': 'Full screen', onclick: () => openNote(n, { edit: () => edit({ big: true }) }) }, icon('expand', 13)),
        h('button', { class: 'quiet icon-btn', 'aria-label': 'Edit', 'data-tip': 'Edit', onclick: () => edit() }, icon('pencil', 13)),
        h('button', { class: 'quiet icon-btn', 'aria-label': 'Delete', 'data-tip': 'Delete', onclick: async () => {
          if (!(await ask('Delete this note?', { ok: 'Delete', danger: true }))) return;
          await api.del(`/api/notes/${n.id}`); notes = notes.filter((x) => x !== n); paint(); onChange && onChange(notes);
        } }, icon('trash', 13))),
      renderRich(n.body, { onSize: (i, size) => resize(n, i, size) }));
    function edit({ big = false } = {}) {
      const e2 = editor({ draftKey: `note_edit_${n.id}`, snapshot, minHeight: 90, onSubmit: () => save(), expandInfo: () => `Editing a note · ${n.category}`,
        expandActions: (close) => [h('span', { class: 'grow' }), h('button', { class: 'quiet', onclick: close }, 'Back'), h('button', { class: 'primary', onclick: async () => { await save(); } }, 'Save')] });
      if (e2.isEmpty()) e2.set(n.body);   // a leftover edit draft wins over the saved text
      const sel = h('select', { 'aria-label': 'Focus' }, [...new Set([...categories, n.category])].map((c) => h('option', { value: c, selected: c === n.category }, c)));
      // sent only when changed, so a duel or video time on the note stays
      let sc2 = { mode: rs.length ? 'pick' : 'game', picked: new Set(rs) }, scDirty = false;
      const scBtn = h('button', { class: 'scope-btn small set', type: 'button', onclick: () => openScope(scBtn, sc2, { rounds, allowAuto: false }, (v) => { sc2 = v; scDirty = true; paintSc(); }) });
      const paintSc = () => fill(scBtn, icon(sc2.mode === 'game' ? 'film' : 'grid', 12), h('span', {}, `Saved to ${scopeText(sc2)}`), icon('chevDown', 11));
      paintSc();
      const save = async () => {
        if (e2.isEmpty()) { toast('A note needs some text', 'bad'); return; }
        if (sc2.mode === 'pick' && !sc2.picked.size) { toast('Pick at least one round, or save it to the whole game', 'bad'); return; }
        const body = { body: e2.html(), category: sel.value, ...(scDirty ? { rounds: sc2.mode === 'game' ? [] : [...sc2.picked] } : {}) };
        try { Object.assign(n, await api.patch(`/api/notes/${n.id}`, body)); e2.clear(); if (e2.isBig()) e2.collapse(); paint(); }
        catch (err) { toast(`Not saved: ${err.message}`, 'bad'); }
      };
      fill(row, h('div', { class: 'note-edit' }, h('div', { class: 'row' }, sel, scBtn), e2.el, h('div', { class: 'row end' },
        h('button', { class: 'quiet small', onclick: () => { e2.clear(); view(); paint(); } }, 'Cancel'),
        h('button', { class: 'primary small', onclick: save }, 'Save'))));
      if (big) e2.expand(); else e2.focus();
    }
    view();
    return row;
  }
  const jumpBtn = (n, after = null) => {
    const can = onJump && (n.round || n.t != null || n.kill_key);
    return h('button', { class: 'note-at num', disabled: !can, 'data-tip': 'Jump there', onclick: can ? () => { if (after) after(); onJump(n); } : null }, icon('play', 10), noteLabel(n));
  };
  async function resize(n, index, size) {
    const doc = new DOMParser().parseFromString(`<div>${n.body}</div>`, 'text/html');
    const img = doc.body.firstChild.querySelectorAll('img')[index];
    if (!img) return;
    img.setAttribute('data-size', size);
    try { Object.assign(n, await api.patch(`/api/notes/${n.id}`, { body: doc.body.firstChild.innerHTML })); } catch (err) { toast(`Not saved: ${err.message}`, 'bad'); }
  }

  function paint() {
    count.textContent = notes.length || '';
    paintFilter();
    const r = curRound();
    const shown = notes.filter((n) => shows(n)).sort(byPlace);
    const hidden = notes.length - shown.length;
    const showAll = h('button', { class: 'quiet small', type: 'button', onclick: () => { filter = 'all'; paint(); } }, `Show all ${notes.length}`);
    const empty = !notes.length ? h('p', { class: 'muted small' }, 'No notes yet. Pick a round or a duel, pause the video where it matters, write what you see.')
      : !shown.length ? h('p', { class: 'muted small row-i' }, filter === 'round' && !r ? 'No round open.' : filter === 'round' ? `No notes on round ${r} yet.` : 'No whole-game notes yet.', showAll)
        : null;
    fill(list, ...shown.map(item), empty, shown.length && hidden ? h('div', { class: 'note-more small muted row-i' }, `${hidden} more on other rounds`, showAll) : null);
    shownRound = r; markHere();
  }
  function markHere() {
    const r = curRound();
    list.querySelectorAll('.note').forEach((x) => x.classList.toggle('here', filter !== 'round' && !!r && x.dataset.rounds.split(',').includes(String(r))));
  }
  let shownRound = null;
  const timer = setInterval(() => {
    if (scope.mode === 'auto') paintWhere();
    const r = curRound();
    if (r === shownRound) return;
    // a note being edited stays open; the list follows the round once it is closed
    if (filter === 'all' || list.querySelector('.note-edit')) { shownRound = r; paintFilter(); markHere(); return; }
    paint();
  }, 500);

  // every note of the review in a big window, grouped by round, focus or key lesson
  function openOverview() {
    let group = local.get('notes_group', 'round');
    const body = h('div', { class: 'ov-body' });
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.lightbox')) { e.stopPropagation(); close(); } };
    const seg = h('div', { class: 'note-filter', role: 'tablist', 'aria-label': 'Group by' });
    const paintOv = () => {
      fill(seg, ...[['round', 'Round'], ['focus', 'Focus'], ['lesson', 'Key lessons']].map(([g, label]) => h('button', { type: 'button', role: 'tab', class: group === g ? 'on' : '', 'aria-selected': String(group === g),
        onclick: () => { group = g; local.set('notes_group', g); paintOv(); } }, label)));
      const groups = new Map();
      const keyOf = (n) => (group === 'focus' ? n.category : group === 'lesson' ? (n.starred ? 'Key lessons' : 'Other notes') : roundsOf(n).length ? `${roundsOf(n).length > 1 ? 'Rounds' : 'Round'} ${roundsOf(n).join(', ')}` : 'Whole game');
      const sorted = notes.slice().sort(group === 'focus' ? (a, b) => (categories.indexOf(a.category) + 1 || 99) - (categories.indexOf(b.category) + 1 || 99) || byPlace(a, b)
        : group === 'lesson' ? (a, b) => b.starred - a.starred || byPlace(a, b) : (a, b) => (roundsOf(a).length ? 1 : 0) - (roundsOf(b).length ? 1 : 0) || byPlace(a, b));
      for (const n of sorted) { const k = keyOf(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
      fill(body, ...(notes.length ? [...groups].map(([k, ns]) => h('section', { class: 'ov-group' }, h('h3', {}, k, h('span', { class: 'n' }, ns.length)),
        ns.map((n) => h('div', { class: `note${n.starred ? ' starred' : ''}` },
          h('div', { class: 'note-head' }, jumpBtn(n, close), h('span', { class: 'note-cat' }, n.category), n.starred ? h('span', { class: 'star-btn on row-i' }, icon('star', 12)) : null,
            n.kill_key && killLabel(n.kill_key) ? h('span', { class: 'muted small' }, killLabel(n.kill_key)) : null),
          renderRich(n.body))))) : [h('p', { class: 'muted' }, 'No notes yet.')]));
    };
    const wrap = h('div', { class: 'ed-overlay', onmousedown: (e) => { if (e.target === wrap) close(); } },
      h('div', { class: 'ed-big notes-overview', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'All notes' },
        h('div', { class: 'ed-big-head' }, icon('list', 15), h('b', {}, 'All notes'), h('span', { class: 'muted small' }, `${notes.length} in this review`), h('span', { class: 'grow' }),
          h('span', { class: 'small muted' }, 'Group by'), seg,
          h('button', { class: 'quiet icon-btn', 'aria-label': 'Close (Esc)', 'data-tip': 'Close (Esc)', onclick: close }, icon('x', 16))),
        body));
    paintOv();
    document.body.append(wrap);
    document.addEventListener('keydown', onKey, true);
  }

  put(el, h('div', { class: 'notes-head' }, icon('pencil', 14), h('h3', {}, 'Notes'), count, h('span', { class: 'grow' }),
      h('button', { class: 'quiet small row-i', type: 'button', 'data-tip': 'Every note of this review, grouped by round, focus or key lesson', onclick: openOverview }, icon('list', 13), 'Overview')),
    h('div', { class: 'note-compose' }, cats, ed.el, h('div', { class: 'row note-add' }, star, where, h('span', { class: 'grow' }), addBtn)), filterBar, list);
  paintCats(); paint(); paintWhere();
  return { el, focus: () => ed.focus(), destroy: () => clearInterval(timer), notes: () => notes,
    insertImage: async (blob) => { await ed.insertBlob(blob); ed.focus(); } };

  // one saved note, big (reading its screenshots); "Edit" opens it in the big editor
  function openNote(n, { edit }) {
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.lightbox')) { e.stopPropagation(); close(); } };
    const wrap = h('div', { class: 'ed-overlay', onmousedown: (e) => { if (e.target === wrap) close(); } },
      h('div', { class: 'ed-big note-big', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Note' },
        h('div', { class: 'ed-big-head' }, jumpBtn(n, close), h('span', { class: 'note-cat' }, n.category), n.starred ? h('span', { class: 'star-btn on row-i' }, icon('star', 13), 'Key lesson') : null,
          h('span', { class: 'grow' }), h('button', { class: 'quiet icon-btn', 'aria-label': 'Close (Esc)', 'data-tip': 'Close (Esc)', onclick: close }, icon('x', 16))),
        h('div', { class: 'ov-body' }, renderRich(n.body, { onSize: (i, size) => resize(n, i, size) })),
        h('div', { class: 'ed-big-foot' }, h('span', { class: 'grow' }), h('button', { onclick: () => { close(); edit(); } }, icon('pencil', 13), 'Edit'))));
    document.body.append(wrap);
    document.addEventListener('keydown', onKey, true);
  }
}

// [] = the whole game
export const roundsOf = (n) => (n.rounds ? String(n.rounds).split(',').map(Number).filter(Boolean) : n.round ? [n.round] : []);

// rounds: [{ n, won }]; sc: { mode, picked: Set }; done(scope) on every change
function openScope(anchor, sc, { rounds, allowAuto, autoText = () => '' }, done) {
  document.querySelector('.scope-pop')?.remove();
  let mode = sc.mode, picked = new Set(sc.picked);
  const pop = h('div', { class: 'scope-pop', role: 'dialog', 'aria-label': 'Where the note is saved' });
  const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const emit = () => done({ mode, picked: new Set(picked) });
  const opt = (m, ico, title, sub) => h('button', { type: 'button', class: `scope-opt${mode === m ? ' on' : ''}`, onclick: () => { mode = m; emit(); paint(); if (m !== 'pick') close(); } },
    icon(ico, 14), h('span', {}, h('b', {}, title), sub ? h('small', {}, sub) : null));
  function paint() {
    fill(pop, h('small', { class: 'muted scope-title' }, 'Save this note to'),
      allowAuto ? opt('auto', 'mapPin', 'What you are looking at', autoText()) : null,
      opt('game', 'film', 'The whole game', 'Not tied to a round'),
      opt('pick', 'grid', 'Several rounds', 'Pick them below'),
      mode === 'pick' ? h('div', { class: 'scope-rounds' }, rounds.map((r, i) => [i === 12 ? h('span', { class: 'sep' }) : null,
        h('button', { type: 'button', class: `rchip mini ${r.won == null ? '' : r.won ? 'won' : 'lost'}${picked.has(r.n) ? ' on' : ''}`, 'aria-pressed': String(picked.has(r.n)),
          onclick: () => { if (picked.has(r.n)) picked.delete(r.n); else picked.add(r.n); emit(); paint(); } }, r.n)])) : null,
      mode === 'pick' ? h('div', { class: 'row end' }, h('span', { class: 'small muted grow' }, picked.size ? `${picked.size} round${picked.size === 1 ? '' : 's'}` : 'none picked'),
        h('button', { class: 'quiet small', type: 'button', onclick: () => { picked.clear(); emit(); paint(); } }, 'Clear'),
        h('button', { class: 'primary small', type: 'button', onclick: close }, 'Done')) : null);
  }
  paint();
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), w = 440;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  const below = window.innerHeight - r.bottom > 340;
  if (below) pop.style.top = `${r.bottom + 6}px`; else pop.style.bottom = `${window.innerHeight - r.top + 6}px`;
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); }, 0);
}
