// Children are always inserted as text nodes, never HTML: names from match data can't inject markup.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function put(el, ...kids) { el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }
// replaceChildren that skips null / false (optional parts)
export function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }

// as a tag, so a name like "For A" doesn't read as part of the sentence. team: 'ally' | 'enemy' | 'me' | ''
export const nameTag = (name, team = '') => h('span', { class: `pname ${team}` }, name || '?');
// parts: strings or [name, team]
export const says = (...parts) => parts.map((p) => (Array.isArray(p) ? nameTag(p[0], p[1]) : p));

export const help = (text) => h('span', { class: 'help', tabindex: '0', 'data-tip': text, 'aria-label': text }, '?');

export function stagger(el, max = 10) {
  if (!el) return el;
  [...el.children].forEach((c, i) => { c.style.setProperty('--i', Math.min(i, max)); c.classList.add('rise'); });
  return el;
}

// per-browser memory for small things; may be unavailable
export const local = {
  get(k, fallback = null) { try { const v = localStorage.getItem('vrt_' + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('vrt_' + k, JSON.stringify(v)); } catch {} },
};

let toastTimer = null;
export function toast(msg, kind = '') {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

export const pct = (v, dash = '–') => (v == null || !Number.isFinite(v) ? dash : `${Math.round(v * 100)}%`);
export const clockMs = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
export const clockS = (s) => { s = Math.max(0, Math.round(s || 0)); const hh = Math.floor(s / 3600); return `${hh ? hh + ':' : ''}${String(Math.floor((s % 3600) / 60)).padStart(hh ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const dayLabel = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const dateTime = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
// SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) → ISO
export const sqlDate = (s) => (s && !s.includes('T') ? s.replace(' ', 'T') + 'Z' : s);

export function emptyState(icon, title, text, action = null) {
  return h('div', { class: 'empty' }, icon, h('h3', {}, title), text ? h('p', { class: 'muted' }, text) : null, action);
}

export function installTooltips() {
  const tip = h('div', { class: 'tip', role: 'tooltip' });
  document.body.append(tip);
  let cur = null;
  const show = (el) => {
    cur = el;
    tip.textContent = el.dataset.tip;
    tip.classList.add('on');
    const r = el.getBoundingClientRect(), tw = Math.min(320, tip.offsetWidth);
    let x = r.left + r.width / 2 - tw / 2, y = r.top - tip.offsetHeight - 8;
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const hide = () => { cur = null; tip.classList.remove('on'); };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
}

// instead of confirm(), which blocks the video players
export function ask(text, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { wrap.remove(); resolve(v); };
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(false); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('p', {}, text),
        h('div', { class: 'row end' }, h('button', { class: 'quiet', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: danger ? 'danger' : 'primary', onclick: () => close(true) }, ok))));
    document.body.append(wrap);
    wrap.querySelector('button:last-child').focus();
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
  });
}
