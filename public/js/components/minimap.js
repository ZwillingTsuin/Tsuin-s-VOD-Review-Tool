// SVG over the minimap in map units (0..1000); positions come as [u, v] in 0..1. Markers keep their screen size
// while zooming.
import { h, local } from '../ui.js';
import { icon } from '../icons.js';

const NS = 'http://www.w3.org/2000/svg';
let clipN = 0;
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const X = (uv) => uv[0] * 1000, Y = (uv) => uv[1] * 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uvOf = (p) => (!p ? null : Array.isArray(p) ? p : p.u != null ? [p.u, p.v] : null);

// the images have a wide empty border: start cropped to the area the callouts span
function viewOf(callouts) {
  const pts = callouts.map((c) => c.uv).filter(Boolean);
  if (pts.length < 4) return { x: 0, y: 0, s: 1000 };
  const us = pts.map((p) => p[0] * 1000), vs = pts.map((p) => p[1] * 1000);
  const x0 = Math.min(...us), x1 = Math.max(...us), y0 = Math.min(...vs), y1 = Math.max(...vs);
  const size = Math.min(1000, Math.max(x1 - x0, y1 - y0) * 1.16 + 60);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { x: clamp(cx - size / 2, 0, 1000 - size), y: clamp(cy - size / 2, 0, 1000 - size), s: size };
}

// the planted spike as the game's minimap draws it
const SPIKE = () => [
  s('circle', { r: 21, class: 'mm-spike-disc' }),
  s('path', { class: 'mm-spike-body', d: 'M0,-15 L5,-9 L5,6 L9,11 L9,14 L-9,14 L-9,11 L-5,6 L-5,-9 Z' }),
  s('path', { class: 'mm-spike-core', d: 'M-2,-6 L2,-6 L2,5 L-2,5 Z' }),
];

export function minimap({ src, callouts = [], cls = '', alt = 'minimap' }) {
  const clip = `mmclip${++clipN}`;
  const home = viewOf(callouts);
  let view = { ...home };
  const svg = s('svg', { viewBox: `${view.x} ${view.y} ${view.s} ${view.s}`, class: 'mm-svg', role: 'img', 'aria-label': alt },
    s('defs', {}, s('clipPath', { id: clip, clipPathUnits: 'objectBoundingBox' }, s('circle', { cx: 0.5, cy: 0.5, r: 0.5 }))),
    src ? s('image', { href: src, x: 0, y: 0, width: 1000, height: 1000, class: 'mm-img', preserveAspectRatio: 'none' }) : null);
  const calls = s('g', { class: 'mm-calls' }), base = s('g', { class: 'mm-base' }), mid = s('g', { class: 'mm-mid' }), top = s('g', { class: 'mm-top' });
  svg.append(calls, base, mid, top);
  const zb = (ico, title, fn) => h('button', { type: 'button', class: 'mm-zbtn', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } }, ico);
  const tools = h('div', { class: 'mm-tools' },
    zb(icon('plus', 14), 'Zoom in (or scroll on the map)', () => zoomBy(0.6)),
    zb(h('span', { class: 'mm-minus' }, '−'), 'Zoom out', () => zoomBy(1 / 0.6)),
    zb(icon('refresh', 13), 'Whole map', () => api.reset()));
  const el = h('div', { class: `mm ${cls}` }, svg, tools);

  const marks = new Set();
  const k = () => view.s / home.s;
  const place = (g) => g.setAttribute('transform', `translate(${g._x} ${g._y}) scale(${k().toFixed(4)})`);
  function mark(uv, cls2, children, { tip, onclick, layer = base } = {}) {
    const g = s('g', { class: `mk ${cls2}`, 'data-tip': tip, onclick, style: onclick ? 'cursor:pointer' : null }, children);
    g._x = X(uv); g._y = Y(uv);
    place(g); marks.add(g);
    g.addEventListener('mouseenter', () => { if (g.parentNode && g.parentNode.lastChild !== g) g.parentNode.append(g); });
    layer.append(g);
    return g;
  }
  for (const c of callouts) if (c.uv) {
    const label = /spawn/i.test(c.name) ? 'Spawn' : c.zone && c.zone.length === 1 ? `${c.zone} ${c.region}` : c.region || c.name;
    mark(c.uv, `mm-call${/spawn/i.test(c.name) ? ' spawn' : ''}`, s('text', { 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, label), { layer: calls });
  }

  function setView(v, animate = false) {
    const size = clamp(v.s, 120, 1000);
    const target = { s: size, x: clamp(v.x, 0, 1000 - size), y: clamp(v.y, 0, 1000 - size) };
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { view = target; apply(); return; }
    const from = { ...view }, t0 = performance.now(), dur = 260;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, s: from.s + (target.s - from.s) * e };
      apply();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function apply() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.s} ${view.s}`);
    marks.forEach((g) => (g.isConnected ? place(g) : marks.delete(g)));
    el.classList.toggle('zoomed', view.s < home.s * 0.97);
    if (pen.strokes.length) paintStrokes();   // arrow heads keep their size on screen
  }

  // stroke: { t: 'pen' | 'line' | 'arrow' | 'circle', c: colour, w: 2 | 4 | 7 (screen px), p: [[x, y], …] in map units }
  const drawG = s('g', { class: 'mm-draw' });
  svg.append(drawG);
  const pen = { on: false, locked: false, tool: 'pen', color: '#ff4655', width: 4, strokes: [], undo: [], cur: null, onChange: null };
  function strokeNode(st) {
    const common = { stroke: st.c, 'stroke-width': st.w, 'vector-effect': 'non-scaling-stroke', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const [a, b] = [st.p[0], st.p[st.p.length - 1]];
    if (st.t === 'circle') return s('circle', { cx: a[0], cy: a[1], r: Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])), ...common });
    if (st.t === 'pen') return s('path', { d: st.p.length === 1 ? `M${a[0]} ${a[1]}l0.01 0` : `M${st.p.map((q) => `${q[0]} ${q[1]}`).join('L')}`, ...common });
    const g = s('g', {}, s('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...common }));
    if (st.t === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = (10 + st.w * 2) * k();
      const p1 = [b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)], p2 = [b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)];
      g.append(s('path', { d: `M${p1[0]} ${p1[1]}L${b[0]} ${b[1]}L${p2[0]} ${p2[1]}`, ...common }));
    }
    return g;
  }
  function paintStrokes() { drawG.replaceChildren(...pen.strokes.map(strokeNode), ...(pen.cur ? [strokeNode(pen.cur)] : [])); }
  const changed = () => { paintStrokes(); if (pen.onChange) pen.onChange(pen.strokes.map((x) => ({ ...x, p: x.p.map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]) }))); };
  const distToStroke = (st, [x, y]) => {
    if (st.t === 'circle') { const [a, b] = [st.p[0], st.p[st.p.length - 1]]; return Math.abs(Math.hypot(x - a[0], y - a[1]) - Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const pts = st.t === 'pen' ? st.p : [st.p[0], st.p[st.p.length - 1]];
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[i + 1] || a, dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)));
    }
    return best;
  };
  function erase(pt) {
    const before = pen.strokes.length;
    pen.strokes = pen.strokes.filter((st) => distToStroke(st, pt) > 10 * k());
    if (pen.strokes.length !== before) { pen.undo = []; changed(); }
  }
  svg.addEventListener('pointerdown', (e) => {
    if (!pen.on || pen.locked || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const pt = toMap(e);
    if (pen.tool === 'eraser') { pen.erasing = true; erase(pt); return; }
    pen.cur = { t: pen.tool, c: pen.color, w: pen.width, p: [pt, pt] };
    if (pen.tool === 'pen') pen.cur.p = [pt];
    paintStrokes();
  }, true);
  svg.addEventListener('pointermove', (e) => {
    if (!pen.on) return;
    const pt = toMap(e);
    if (pen.erasing) { erase(pt); return; }
    if (!pen.cur) return;
    e.stopImmediatePropagation();
    if (pen.cur.t === 'pen') { const last = pen.cur.p[pen.cur.p.length - 1]; if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 1.5 * k()) pen.cur.p.push(pt); }
    else pen.cur.p[1] = pt;
    paintStrokes();
  }, true);
  const endStroke = (e) => {
    if (!pen.on) return;
    if (pen.erasing) { pen.erasing = false; return; }
    if (!pen.cur) return;
    e.stopImmediatePropagation();
    const st = pen.cur; pen.cur = null;
    const [a, b] = [st.p[0], st.p[st.p.length - 1]];
    if (st.t === 'pen' || Math.hypot(b[0] - a[0], b[1] - a[1]) > 3 * k()) { pen.strokes.push(st); pen.undo = []; }
    changed();
  };
  svg.addEventListener('pointerup', endStroke, true);
  svg.addEventListener('pointercancel', endStroke, true);
  // while drawing, a click on the map must not open a duel
  svg.addEventListener('click', (e) => { if (pen.on) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  const COLORS = [['#ff4655', 'Red'], ['#3ecfa6', 'Teal'], ['#f2b33d', 'Yellow'], ['#6fb3ff', 'Blue'], ['#ffffff', 'White']];
  const TOOLS = [['pen', 'pencil', 'Pen: draw freely'], ['arrow', 'arrowRight', 'Arrow'], ['line', 'minus', 'Line'], ['circle', 'circle', 'Circle'], ['eraser', 'eraser', 'Eraser: drag over a drawing to remove it']];
  const drawBar = h('div', { class: 'mm-drawbar' });
  let drawOpts = {};
  function paintBar() {
    const btn = (ico, tip, on, fn, extra = '') => h('button', { type: 'button', class: `mm-dbtn${on ? ' on' : ''} ${extra}`, 'data-tip': tip, 'aria-label': tip, 'aria-pressed': String(!!on), onclick: (e) => { e.stopPropagation(); fn(); } }, ico);
    const toggle = btn(icon('brush', 15), pen.on ? 'Stop drawing (back to moving the map)' : 'Draw on the map (saved with this round)', pen.on, () => { pen.on = !pen.on; el.classList.toggle('drawing', pen.on); paintBar(); }, 'main');
    if (!pen.on) { drawBar.replaceChildren(toggle); return; }
    drawBar.replaceChildren(toggle, h('span', { class: 'mm-dsep' }),
      ...TOOLS.map(([t, ico, tip]) => btn(icon(ico, 14), tip, pen.tool === t, () => { pen.tool = t; paintBar(); })),
      h('span', { class: 'mm-dsep' }),
      ...COLORS.map(([c, name]) => btn(h('i', { class: 'mm-swatch', style: { background: c } }), name, pen.color === c, () => { pen.color = c; if (pen.tool === 'eraser') pen.tool = 'pen'; paintBar(); }, 'swatch')),
      h('span', { class: 'mm-dsep' }),
      ...[[2, 'Thin'], [4, 'Normal'], [7, 'Thick']].map(([w, tip]) => btn(h('i', { class: 'mm-width', style: { height: `${w}px` } }), tip, pen.width === w, () => { pen.width = w; paintBar(); }, 'width')),
      h('span', { class: 'mm-dsep' }),
      btn(icon('undo', 14), 'Undo (Ctrl+Z)', false, undo), btn(icon('redo', 14), 'Redo (Ctrl+Y)', false, redo),
      btn(icon('trash', 14), 'Clear this drawing', false, () => { if (!pen.strokes.length) return; pen.undo = [pen.strokes]; pen.strokes = []; changed(); }),
      drawOpts.onAddToNote ? h('span', { class: 'mm-dsep' }) : null,
      drawOpts.onAddToNote ? btn(icon('image', 14), 'Add the map with this drawing to your note', false, async () => { try { await drawOpts.onAddToNote(); } catch (err) { console.error(err); } }, 'note') : null);
  }
  const undoStack = [];
  function undo() { if (!pen.strokes.length && !pen.undo.length) return; if (pen.undo.length && !pen.strokes.length) { pen.strokes = pen.undo.shift(); pen.undo = []; changed(); return; } undoStack.push(pen.strokes.pop()); changed(); }
  function redo() { if (!undoStack.length) return; pen.strokes.push(undoStack.pop()); changed(); }
  const onKey = (e) => {
    if (!el.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    if (!pen.on || (e.target.closest && e.target.closest('input, textarea, [contenteditable]'))) return;
    const kk = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && kk === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && kk === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Escape') { e.stopPropagation(); pen.on = false; el.classList.remove('drawing'); paintBar(); }
  };
  document.addEventListener('keydown', onKey, true);
  function zoomBy(f, cx = view.x + view.s / 2, cy = view.y + view.s / 2, animate = true) {
    const ns = clamp(view.s * f, 120, 1000);
    setView({ s: ns, x: cx - (cx - view.x) * (ns / view.s), y: cy - (cy - view.y) * (ns / view.s) }, animate);
  }
  const toMap = (e) => { const r = svg.getBoundingClientRect(); return [view.x + ((e.clientX - r.left) / r.width) * view.s, view.y + ((e.clientY - r.top) / r.height) * view.s]; };
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const [mx, my] = toMap(e); zoomBy(e.deltaY < 0 ? 0.8 : 1.25, mx, my, false); }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, v: { ...view }, moved: false, id: e.pointerId }; });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; svg.setPointerCapture(drag.id); el.classList.add('panning'); }
    setView({ s: drag.v.s, x: drag.v.x - (dx / r.width) * drag.v.s, y: drag.v.y - (dy / r.height) * drag.v.s });
  });
  const endDrag = () => { if (drag && drag.moved) { el.classList.remove('panning'); svg.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true }); } drag = null; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  const api = {
    el, svg, base, mid, top,
    // enable() once; set(strokes) per round; lock(true) where nothing is saved
    drawing: {
      enable(opts = {}) { drawOpts = opts; pen.onChange = opts.onChange || null; el.append(drawBar); paintBar(); },
      set(strokes) { pen.strokes = (strokes || []).map((x) => ({ ...x, p: x.p.map((q) => [...q]) })); pen.undo = []; undoStack.length = 0; pen.cur = null; paintStrokes(); },
      lock(on) { pen.locked = !!on; drawBar.classList.toggle('locked', !!on); if (on && pen.on) { pen.on = false; el.classList.remove('drawing'); paintBar(); } },
      strokes: () => pen.strokes,
    },
    // the visible (zoomed) part with the drawing, plus whatever extra(ctx, toPx) paints → PNG blob
    async snapshot({ size = 900, extra = null } = {}) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, size, size);
      if (src) {
        const img = new Image();
        img.src = src;
        await img.decode();
        const f = img.naturalWidth / 1000;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(img, view.x * f, view.y * f, view.s * f, view.s * f, 0, 0, size, size);
        ctx.globalAlpha = 1;
      }
      const toPx = ([x, y]) => [((x - view.x) / view.s) * size, ((y - view.y) / view.s) * size];
      const scale = size / (svg.getBoundingClientRect().width || size);   // stroke widths are in screen pixels
      if (extra) extra(ctx, toPx, scale);
      for (const st of pen.strokes) {
        ctx.strokeStyle = st.c; ctx.lineWidth = st.w * scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const pts = st.p.map(toPx), a = pts[0], b = pts[pts.length - 1];
        ctx.beginPath();
        if (st.t === 'circle') ctx.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]), 0, Math.PI * 2);
        else if (st.t === 'pen') { ctx.moveTo(a[0], a[1]); for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]); if (pts.length === 1) ctx.lineTo(a[0] + 0.1, a[1]); }
        else {
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          if (st.t === 'arrow') { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = (10 + st.w * 2) * scale; ctx.moveTo(b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)); }
        }
        ctx.stroke();
      }
      return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    },
    clear() { base.innerHTML = ''; mid.innerHTML = ''; top.innerHTML = ''; svg.querySelectorAll('.mm-heat').forEach((n) => n.remove()); },
    labels(on) { el.classList.toggle('show-calls', !!on); },
    fit(uvs, { pad = 90, min = 260 } = {}) {
      const pts = uvs.filter(Boolean);
      if (!pts.length) return;
      const xs = pts.map(X), ys = pts.map(Y);
      const size = Math.max(min, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + pad * 2);
      setView({ s: size, x: (Math.min(...xs) + Math.max(...xs)) / 2 - size / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - size / 2 }, true);
    },
    reset(animate = true) { setView(home, animate); },
    dot(uv, { cls: c = '', r = 9, tip, onclick, layer = base } = {}) { return uv ? mark(uv, `mm-dot ${c}`, s('circle', { r }), { tip, onclick, layer }) : null; },
    cross(uv, { cls: c = '', size = 11, tip, onclick, layer = base } = {}) {
      if (!uv) return null;
      return mark(uv, `mm-x ${c}`, [s('circle', { r: size + 5, class: 'mm-hit' }), s('path', { d: `M${-size},${-size}L${size},${size}M${size},${-size}L${-size},${size}` })], { tip, onclick, layer });
    },
    agent(uv, { img, cls: c = '', r = 20, facing, tip, onclick, layer = top } = {}) {
      if (!uv) return null;
      return mark(uv, `mm-agent ${c}`, [
        facing ? s('line', { x1: 0, y1: 0, x2: facing[0] * (r + 30), y2: facing[1] * (r + 30), class: 'mm-face' }) : null,
        facing ? s('path', { class: 'mm-face-tip', d: 'M0,-5 L9,0 L0,5 Z', transform: `translate(${facing[0] * (r + 30)} ${facing[1] * (r + 30)}) rotate(${(Math.atan2(facing[1], facing[0]) * 180) / Math.PI})` }) : null,
        s('circle', { r: r + 3, class: 'mm-ring' }),
        img ? s('image', { href: img, x: -r, y: -r, width: r * 2, height: r * 2, 'clip-path': `url(#${clip})` }) : null,
      ], { tip, onclick, layer });
    },
    line(a, b, { cls: c = '', layer = base } = {}) {
      if (!a || !b) return null;
      const n = s('line', { x1: X(a), y1: Y(a), x2: X(b), y2: Y(b), class: `mm-line ${c}`, 'vector-effect': 'non-scaling-stroke' });
      layer.append(n); return n;
    },
    spike(uv, { text = '', tip, layer = top } = {}) { return uv ? mark(uv, 'mm-spike', [...SPIKE(), text ? s('text', { y: 46, 'text-anchor': 'middle' }, text) : null], { tip, layer }) : null; },
    text(uv, str, { cls: c = '', dx = 0, dy = -20, layer = top } = {}) { return uv ? mark(uv, `mm-text ${c}`, s('text', { x: dx, y: dy, 'text-anchor': 'middle' }, str), { layer }) : null; },
  };
  return api;
}

// drawn in map space, so it zooms with the map
const RAMPS = {
  red: [[110, 0, 22], [255, 70, 85], [255, 165, 90], [255, 244, 205]],
  blue: [[16, 40, 110], [57, 135, 229], [140, 200, 255], [232, 246, 255]],
};
function heatImage(uvs, { color = 'red', size = 256, sigma = 0.015 } = {}) {
  const n = size, grid = new Float32Array(n * n), sg = sigma * n, r = Math.ceil(sg * 3);
  const kernel = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) kernel.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sg * sg))]);
  for (const [u, v] of uvs) {
    const cx = Math.round(u * n), cy = Math.round(v * n);
    for (const [dx, dy, w] of kernel) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < n && y < n) grid[y * n + x] += w; }
  }
  let max = 0; for (const g of grid) if (g > max) max = g;
  const canvas = document.createElement('canvas'); canvas.width = n; canvas.height = n;
  const cx = canvas.getContext('2d'), img = cx.createImageData(n, n), ramp = RAMPS[color] || RAMPS.red;
  for (let i = 0; i < grid.length; i++) {
    const t = max ? grid[i] / max : 0;
    if (t < 0.03) continue;
    const pos = Math.min(0.999, Math.sqrt(t)) * (ramp.length - 1), a = Math.floor(pos), f = pos - a;
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = ramp[a][c] + (ramp[a + 1][c] - ramp[a][c]) * f;
    img.data[i * 4 + 3] = Math.round(255 * Math.min(0.9, 0.15 + Math.pow(t, 0.55)));
  }
  cx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
export function addHeat(map, uvs, opts) {
  if (!uvs.length) return null;
  const node = s('image', { href: heatImage(uvs, opts), x: 0, y: 0, width: 1000, height: 1000, class: 'mm-heat', preserveAspectRatio: 'none' });
  map.base.before(node);
  return node;
}

export function mapToggle({ key, label, ico, tip, onChange, def = false }) {
  let on = local.get(key, def);
  const b = h('button', { class: `chip${on ? ' on' : ''}`, type: 'button', 'data-tip': tip }, icon(ico, 13), label);
  b.onclick = () => { on = !on; b.classList.toggle('on', on); local.set(key, on); onChange(on); };
  b.isOn = () => on;
  return b;
}
export function calloutToggle(map) {
  const b = mapToggle({ key: 'mm_callouts', label: 'Callouts', ico: 'tag', tip: 'Show the callout names on the map', onChange: (on) => map.labels(on) });
  map.labels(b.isOn());
  return b;
}
