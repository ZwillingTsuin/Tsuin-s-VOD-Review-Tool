// items: [{ value, label, sub?, img?, n? } | { header }]. watchSelects() turns every native <select> into one; the
// select stays (hidden) as the source of truth, so code using it keeps working.
import { h } from '../ui.js';
import { icon } from '../icons.js';

export function dropdown({ items, value, onChange, title = '', cls = '' }) {
  const wrap = h('div', { class: `dd ${cls}` });
  const btn = h('button', { class: 'dd-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': title || null });
  const menu = h('div', { class: 'dd-menu', role: 'listbox', hidden: true });
  wrap.append(btn, menu);
  const face = (it) => [
    it.img ? h('img', { class: 'dd-img', src: it.img, alt: '', loading: 'lazy' }) : null,
    h('span', { class: 'dd-label' }, h('b', {}, it.label), it.sub ? h('small', {}, it.sub) : null),
    it.n != null ? h('span', { class: 'dd-n num' }, it.n) : null,
  ].filter(Boolean);
  const choices = () => items.filter((it) => !it.header);
  const paint = () => {
    const cur = choices().find((it) => String(it.value) === String(value)) || choices()[0];
    btn.replaceChildren(...(cur ? face(cur) : []), icon('chevDown', 14));
    menu.replaceChildren();
    for (const it of items) {
      if (it.header) { menu.append(h('div', { class: 'dd-head' }, it.header)); continue; }
      const on = String(it.value) === String(value);
      menu.append(h('button', { type: 'button', role: 'option', class: `dd-opt${on ? ' on' : ''}`, disabled: !!it.disabled, 'aria-selected': String(on),
        onclick: () => { close(); if (!on) { value = it.value; paint(); onChange(it.value); } } }, ...face(it)));
    }
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => {
    const opts = [...menu.querySelectorAll('.dd-opt:not([disabled])')], at = opts.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (opts[Math.max(0, Math.min(opts.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))] || opts[0])?.focus(); }
  };
  function open() {
    wrap.dispatchEvent(new Event('dd-open'));
    menu.hidden = false; wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    wrap.classList.toggle('up', window.innerHeight - r.bottom < 260 && r.top > 300);
    document.addEventListener('mousedown', outside); wrap.addEventListener('keydown', onKey);
    (menu.querySelector('.dd-opt.on') || menu.querySelector('.dd-opt'))?.focus({ preventScroll: true });
    menu.querySelector('.dd-opt.on')?.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    menu.hidden = true; wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside); wrap.removeEventListener('keydown', onKey);
  }
  btn.onclick = () => (menu.hidden ? open() : close());
  paint();
  wrap.set = (v, newItems) => { value = v; if (newItems) items = newItems; paint(); };
  return wrap;
}

export function enhanceSelect(sel) {
  if (sel._dd || sel.multiple || sel.closest('.dd')) return;
  const opt = (o) => ({ value: o.value, label: o.textContent, sub: o.dataset.sub || null, img: o.dataset.img || null, n: o.dataset.n ?? null, disabled: o.disabled });
  const read = () => [...sel.children].flatMap((c) => (c.tagName === 'OPTGROUP' ? [{ header: c.label }, ...[...c.children].map(opt)] : [opt(c)]));
  const dd = dropdown({
    items: read(), value: sel.value, title: sel.getAttribute('aria-label') || '', cls: `dd-native${sel.className ? ' ' + sel.className : ''}`,
    onChange: (v) => { sel.value = v; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); },
  });
  sel._dd = dd;
  sel.classList.add('dd-hidden');
  sel.after(dd);
  const sync = () => dd.set(sel.value, read());
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true });
  sel.addEventListener('change', sync);
  dd.addEventListener('dd-open', sync);
  setTimeout(sync, 0);   // a value set right after the select was made
}
// now and later: pages re-render parts of themselves
export function watchSelects(root) {
  const run = () => root.querySelectorAll('select:not(.dd-hidden)').forEach(enhanceSelect);
  run();
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; run(); }); }).observe(root, { childList: true, subtree: true });
}
