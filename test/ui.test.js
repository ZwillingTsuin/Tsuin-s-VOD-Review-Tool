// Guards for the stylesheet. The dark-text-on-a-highlighted-option bug came twice from one general rule
// (button.on: white background, dark text) leaking into menus that only set a lighter background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// flat list of rules (media queries opened up): { selectors: [...], body }
const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim();
  if (!sel || sel.startsWith('@')) continue;
  rules.push({ selectors: sel.split(',').map((s) => s.trim()), body: m[2] });
}
const onRules = rules.filter((r) => r.selectors.some((s) => /\.on\b/.test(s)));

test('no general "selected" style for every button or element', () => {
  for (const r of onRules) for (const s of r.selectors) {
    assert.ok(!/^(button)?\.on(\s|:|$)/.test(s), `"${s}" styles every selected button: give the component its own .on rule`);
  }
});

test('a selected state that changes the background also sets its text colour', () => {
  for (const r of onRules) {
    if (!/background(-color)?\s*:/.test(r.body)) continue;
    assert.ok(/(^|;|\s)color\s*:/.test(r.body), `"${r.selectors.join(', ')}" sets a background when selected but no text colour`);
  }
});

test('menu options keep light text when picked', () => {
  const opts = onRules.filter((r) => r.selectors.some((s) => /-opt\.on/.test(s)));
  assert.ok(opts.length >= 2, 'the dropdown and the "Saved to" menu have their own .on rule');
  for (const r of opts) {
    const c = /(^|;|\s)color\s*:\s*([^;]+)/.exec(r.body);
    assert.ok(c && !/#1\d\d|#000|black/i.test(c[2]), `"${r.selectors.join(', ')}" must keep light text`);
  }
});
