// Pictures are uploaded to the data folder and referenced by URL, not embedded. renderRich() keeps only the allowed
// tags (the server filters the same way when saving).
import { h, toast, local } from '../ui.js';
import { icon } from '../icons.js';

const IMG_SRC = /^\/api\/images\/[a-f0-9]{24}\.(png|jpg|webp|gif)$/;
const ALLOWED = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'H3', 'H4', 'BLOCKQUOTE', 'CODE', 'A', 'IMG', 'SPAN']);
export const isRich = (s) => /<(p|div|br|b|strong|i|em|u|s|ul|ol|li|h3|h4|blockquote|code|a|img|span)\b/i.test(String(s || ''));

// min = folded into a button; s / m / l = up to 200 / 360 / 600 px
export const SIZES = [['min', 'Folded', 'Fold into a small button'], ['s', 'S', 'Small'], ['m', 'M', 'Medium'], ['l', 'L', 'Large'], ['full', 'Full', 'Full width']];
const sizeOf = (img) => (SIZES.some(([k]) => k === img.getAttribute('data-size')) ? img.getAttribute('data-size') : 'm');

// onSize(index, size): pictures get a size bar on hover
export function renderRich(body, { lightbox = true, onSize = null } = {}) {
  const box = h('div', { class: 'rich' });
  if (!isRich(body)) { box.classList.add('plain'); box.textContent = String(body || ''); return box; }
  const doc = new DOMParser().parseFromString(`<div>${body}</div>`, 'text/html');
  let imgN = 0;
  const copy = (node, into) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { into.append(document.createTextNode(c.textContent)); continue; }
      if (c.nodeType !== 1) continue;
      if (!ALLOWED.has(c.tagName)) { copy(c, into); continue; }   // unknown wrapper: keep its text
      let el;
      if (c.tagName === 'A') {
        const href = c.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(href)) { copy(c, into); continue; }
        el = h('a', { href, target: '_blank', rel: 'noopener noreferrer' });
      } else if (c.tagName === 'IMG') {
        const src = c.getAttribute('src') || '';
        if (!IMG_SRC.test(src)) continue;
        const size = sizeOf(c);
        const img = h('img', { src, alt: c.getAttribute('alt') || 'screenshot', loading: 'lazy', class: 'note-img', 'data-size': size });
        if (lightbox) img.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openLightbox(src); });
        el = lightbox ? shot(img, size, imgN, onSize) : img;
        imgN++;
      } else el = document.createElement(c.tagName.toLowerCase());
      into.append(el);
      if (c.tagName !== 'IMG') copy(c, el);
    }
  };
  copy(doc.body.firstChild, box);
  return box;
}

export function sizeBar(current, onPick, extra = []) {
  return h('span', { class: 'size-bar', role: 'toolbar', 'aria-label': 'Picture size' },
    ...SIZES.map(([k, label, tip]) => h('button', { type: 'button', class: `sz${current === k ? ' on' : ''}`, 'data-tip': tip, 'aria-label': tip, 'aria-pressed': String(current === k),
      onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.preventDefault(); e.stopPropagation(); onPick(k); } }, k === 'min' ? icon('eyeOff', 12) : label)),
    ...extra);
}

// opening a folded picture is only for now; picking a size saves it
function shot(img, size, index, onSize) {
  const box = h('span', { class: 'shot' });
  let open = false;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const pick = (k) => { size = k; img.setAttribute('data-size', k === 'min' ? 'm' : k); open = false; paint(); if (onSize) onSize(index, k); };
  const paint = () => {
    if (size === 'min' && !open) {
      box.replaceChildren(h('button', { type: 'button', class: 'shot-chip', 'data-tip': 'Show the screenshot', onclick: (e) => { stop(e); open = true; img.setAttribute('data-size', 'm'); paint(); } }, icon('image', 13), 'Screenshot'));
      return;
    }
    const extra = size === 'min' ? [h('button', { type: 'button', class: 'sz', 'data-tip': 'Fold it again', onclick: (e) => { stop(e); open = false; paint(); } }, icon('x', 12))] : [];
    box.replaceChildren(...[img, onSize ? sizeBar(size, pick, extra) : null].filter(Boolean));
  };
  paint();
  return box;
}

export function openLightbox(src) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const wrap = h('div', { class: 'lightbox', onclick: close, role: 'dialog', 'aria-label': 'Screenshot' }, h('img', { src, alt: 'screenshot' }), h('button', { class: 'lb-close', 'aria-label': 'Close' }, icon('x', 18)));
  document.body.append(wrap);
  document.addEventListener('keydown', onKey, true);
}

async function upload(blob) {
  const r = await fetch('/api/images', { method: 'POST', headers: { 'X-VRT': '1', 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The picture could not be saved');
  return j.url;
}

// expandInfo(): the big window's header line; expandActions(close): its buttons
export function editor({ placeholder = '', draftKey = null, onSubmit = null, snapshot = null, minHeight = 120, expandInfo = null, expandActions = null } = {}) {
  const area = h('div', { class: 'ed-area', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder || 'Note', 'data-placeholder': placeholder, spellcheck: 'true', style: { minHeight: `${minHeight}px` } });
  const status = h('span', { class: 'ed-status small muted' });
  let savedRange = null;
  const rememberRange = () => { const s = getSelection(); if (s.rangeCount && area.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); };
  const restoreRange = () => {
    area.focus();
    if (!savedRange) { const r = document.createRange(); r.selectNodeContents(area); r.collapse(false); savedRange = r; }
    const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange);
  };
  ['keyup', 'mouseup', 'input', 'focus'].forEach((ev) => area.addEventListener(ev, rememberRange));

  const cmd = (name, value = null) => { restoreRange(); document.execCommand(name, false, value); rememberRange(); changed(); };
  const block = (tag) => { restoreRange(); const cur = document.queryCommandValue('formatBlock').toLowerCase(); document.execCommand('formatBlock', false, cur === tag ? 'p' : tag); changed(); };

  async function insertImages(files, size = 'm') {
    const imgs = [...files].filter((f) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type));
    if (!imgs.length) return false;
    status.textContent = imgs.length > 1 ? `Saving ${imgs.length} pictures…` : 'Saving the picture…';
    for (const f of imgs) {
      try {
        const url = await upload(f);
        restoreRange();
        document.execCommand('insertHTML', false, `<img src="${url}" alt="screenshot" data-size="${size}"><br>`);
        rememberRange();
      } catch (err) { toast(err.message, 'bad'); }
    }
    status.textContent = '';
    changed();
    return true;
  }
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true, onchange: async () => { await insertImages(file.files); file.value = ''; } });

  // pasted text comes in without the source's styling
  area.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); rememberRange(); await insertImages(files); return; }
    const text = cd.getData('text/plain');
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
  area.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); area.classList.add('drop'); } });
  area.addEventListener('dragleave', () => area.classList.remove('drop'));
  area.addEventListener('drop', async (e) => {
    area.classList.remove('drop');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (r) savedRange = r;
    await insertImages(e.dataTransfer.files);
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit && onSubmit(); return; }
    if (e.key === 'Escape') { if (big) { e.stopPropagation(); collapse(); } else area.blur(); return; }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); cmd('bold'); } else if (k === 'i') { e.preventDefault(); cmd('italic'); } else if (k === 'u') { e.preventDefault(); cmd('underline'); }
      else if (k === 'k') { e.preventDefault(); link(); }
    }
  });
  const imgBar = h('div', { class: 'ed-imgbar', hidden: true });
  let picked = null;
  function pickImage(img) {
    picked = img;
    area.querySelectorAll('img.picked').forEach((x) => x.classList.remove('picked'));
    if (!img) { imgBar.hidden = true; return; }
    img.classList.add('picked');
    const size = SIZES.some(([k]) => k === img.getAttribute('data-size')) ? img.getAttribute('data-size') : 'm';
    imgBar.replaceChildren(sizeBar(size, (k) => { img.setAttribute('data-size', k); changed(); pickImage(img); }, [
      h('button', { type: 'button', class: 'sz', 'data-tip': 'Open it big (or double-click the picture)', 'aria-label': 'Open it big', onmousedown: (e) => e.preventDefault(), onclick: () => openLightbox(img.getAttribute('src')) }, icon('search', 12)),
      h('button', { type: 'button', class: 'sz del', 'data-tip': 'Remove the picture', 'aria-label': 'Remove the picture', onmousedown: (e) => e.preventDefault(), onclick: () => { const next = img.nextSibling; img.remove(); if (next && next.nodeName === 'BR') next.remove(); pickImage(null); changed(); } }, icon('trash', 12))]));
    imgBar.hidden = false;
    placeBar();
  }
  function placeBar() {
    if (!picked || imgBar.hidden) return;
    const er = el.getBoundingClientRect(), ir = picked.getBoundingClientRect();
    imgBar.style.left = `${Math.max(6, ir.left - er.left + 4)}px`;
    imgBar.style.top = `${Math.max(34, ir.top - er.top + 4)}px`;
  }
  area.addEventListener('click', (e) => { pickImage(e.target.tagName === 'IMG' ? e.target : null); });
  area.addEventListener('dblclick', (e) => { if (e.target.tagName === 'IMG') { e.preventDefault(); openLightbox(e.target.getAttribute('src')); } });
  area.addEventListener('scroll', placeBar);
  area.addEventListener('keydown', () => { if (picked) pickImage(null); });

  function link() {
    rememberRange();
    const sel = getSelection().toString();
    const url = prompt('Link (https://…)', /^https?:\/\//.test(sel) ? sel : 'https://');
    if (!url || !/^https?:\/\/\S+$/.test(url)) return;
    if (sel) cmd('createLink', url); else { restoreRange(); document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`); changed(); }
  }
  async function snap() {
    try {
      const blob = await snapshot();
      if (!blob) { toast('No video frame to take right now', 'bad'); return; }
      await insertImages([new File([blob], 'frame.png', { type: 'image/png' })]);
    } catch (err) { toast(err.message, 'bad'); }
  }

  const tb = (ico, tip, fn) => h('button', { type: 'button', class: 'ed-btn', 'data-tip': tip, 'aria-label': tip, onmousedown: (e) => e.preventDefault(), onclick: fn }, icon(ico, 14));
  const tbText = (label, tip, fn, cls = '') => h('button', { type: 'button', class: `ed-btn txt ${cls}`, 'data-tip': tip, 'aria-label': tip, onmousedown: (e) => e.preventDefault(), onclick: fn }, label);
  const toolbar = h('div', { class: 'ed-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tbText('B', 'Bold (Ctrl+B)', () => cmd('bold'), 'b'), tbText('I', 'Italic (Ctrl+I)', () => cmd('italic'), 'i'), tbText('U', 'Underline (Ctrl+U)', () => cmd('underline'), 'u'),
    tbText('S', 'Strikethrough', () => cmd('strikeThrough'), 's'),
    h('span', { class: 'ed-sep' }),
    tbText('H', 'Heading', () => block('h3'), 'hd'), tb('list', 'Bullet list', () => cmd('insertUnorderedList')), tb('listNum', 'Numbered list', () => cmd('insertOrderedList')),
    tb('quote', 'Quote', () => block('blockquote')), tb('link', 'Link (Ctrl+K)', link),
    h('span', { class: 'ed-sep' }),
    tb('image', 'Add a picture (or paste one with Ctrl+V, or drop it in)', () => { rememberRange(); file.click(); }),
    snapshot ? tb('camera', 'Take the current video frame', () => { rememberRange(); snap(); }) : null,
    tb('eraser', 'Clear formatting', () => { cmd('removeFormat'); cmd('formatBlock', 'p'); }),
    h('span', { class: 'grow' }), status, file,
    h('button', { type: 'button', class: 'ed-btn ed-expand', 'data-tip': 'Full screen', 'aria-label': 'Full screen', onmousedown: (e) => e.preventDefault(), onclick: () => (big ? collapse() : expand()) }, icon('expand', 13)));
  const el = h('div', { class: 'editor' }, toolbar, area, imgBar);

  // the same element moves into the big window, so nothing is copied
  let big = null;
  function expand() {
    rememberRange();
    const spot = document.createComment('editor');
    el.replaceWith(spot);
    const info = h('span', { class: 'muted small' }, expandInfo ? expandInfo() : '');
    const timer = setInterval(() => { if (expandInfo) info.textContent = expandInfo(); }, 500);
    const wrap = h('div', { class: 'ed-overlay', onmousedown: (e) => { if (e.target === wrap) collapse(); } },
      h('div', { class: 'ed-big', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Note' },
        h('div', { class: 'ed-big-head' }, icon('pencil', 15), h('b', {}, 'Note'), info, h('span', { class: 'grow' }),
          h('button', { class: 'quiet icon-btn', 'aria-label': 'Back to the small editor (Esc)', 'data-tip': 'Back to the small editor (Esc)', onclick: () => collapse() }, icon('shrink', 16))),
        el,
        expandActions ? h('div', { class: 'ed-big-foot' }, expandActions(() => collapse())) : null));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); collapse(); } });
    document.body.append(wrap);
    el.classList.add('big');
    toolbar.querySelector('.ed-expand').replaceChildren(icon('shrink', 13));
    big = { wrap, spot, timer };
    restoreRange();
  }
  function collapse() {
    if (!big) return;
    rememberRange();
    clearInterval(big.timer);
    big.spot.replaceWith(el);
    big.wrap.remove();
    big = null;
    el.classList.remove('big');
    toolbar.querySelector('.ed-expand').replaceChildren(icon('expand', 13));
  }

  let draftTimer = null;
  function changed() {
    area.classList.toggle('empty', isEmpty());
    if (!draftKey) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (isEmpty()) local.set(draftKey, null); else local.set(draftKey, area.innerHTML); }, 400);
  }
  area.addEventListener('input', changed);
  const isEmpty = () => !area.textContent.trim() && !area.querySelector('img');
  const api = {
    el, area,
    html: () => (isEmpty() ? '' : area.innerHTML.trim()),
    isEmpty,
    set(html) { area.replaceChildren(...(html ? [...renderRich(html, { lightbox: false }).childNodes] : [])); if (html && !isRich(html)) area.innerText = html; changed(); },
    clear() { area.replaceChildren(); if (draftKey) local.set(draftKey, null); area.classList.add('empty'); },
    async insertBlob(blob, name = 'map.png', size = 's') {
      const r = document.createRange(); r.selectNodeContents(area); r.collapse(false); savedRange = r;
      await insertImages([new File([blob], name, { type: blob.type || 'image/png' })], size);
    },
    expand, collapse, isBig: () => !!big,
    focus() { area.focus(); const r = document.createRange(); r.selectNodeContents(area); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); },
  };
  const draft = draftKey ? local.get(draftKey, null) : null;
  if (draft) api.set(draft); else area.classList.add('empty');
  return api;
}
