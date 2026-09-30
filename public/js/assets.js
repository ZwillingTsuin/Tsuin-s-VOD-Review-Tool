import { api } from './api.js';
import { h } from './ui.js';

let data = null;
const maps = new Map(), agents = new Map(), tiers = new Map(), weapons = new Map();

export async function loadAssets() {
  if (data) return data;
  try { data = await api.get('/api/assets'); } catch { data = { maps: [], agents: [], tiers: [], weapons: [] }; }
  for (const m of data.maps) maps.set(m.name.toLowerCase(), m);
  for (const a of data.agents) agents.set(a.id, a);
  for (const t of data.tiers) tiers.set(t.id, t);
  for (const w of data.weapons) weapons.set(w.id, w);
  return data;
}

export const mapArt = (name) => (name ? maps.get(String(name).toLowerCase()) || null : null);
export const agentIcon = (id) => (id ? `https://media.valorant-api.com/agents/${String(id).toLowerCase()}/displayicon.png` : null);
export const tierInfo = (id) => tiers.get(Number(id)) || null;
export const weaponIcon = (id) => (id && weapons.get(String(id).toLowerCase()) ? weapons.get(String(id).toLowerCase()).icon : null);

export function agentImg(id, cls = 'agent-img', alt = '') {
  const src = agentIcon(id);
  if (!src) return h('span', { class: `${cls} blank` });
  const img = h('img', { src, alt, class: cls, loading: 'lazy' });
  img.onerror = () => img.classList.add('blank');
  return img;
}
// tiers 1 and 2 are unused: below 3 is unranked (tier 0 has the game's unranked icon)
export function tierImg(id, cls = 'tier-img') {
  const n = Number(id) || 0;
  const t = tierInfo(n < 3 ? 0 : n);
  if (!t || !t.icon) return h('span', { class: `${cls} blank`, 'data-tip': 'Unranked' });
  return h('img', { src: t.icon, alt: t.name, class: `${cls}${n < 3 ? ' unranked' : ''}`, 'data-tip': n < 3 ? 'Unranked' : t.name, loading: 'lazy' });
}
export const tierName = (id) => (tierInfo(id) || {}).name || (Number(id) < 3 ? 'Unranked' : `Tier ${id}`);
