// Game data from valorant-api.com (maps, agents, ranks, weapons), cached in the data folder and refreshed every few
// days for new patches. Works offline from the cache.
import fs from 'node:fs';
import path from 'node:path';
import { ASSET_DIR, writeFileAtomic } from './paths.js';

const BASE = 'https://valorant-api.com/v1';
const MAX_AGE = 3 * 86400000;
const mem = new Map();

async function cached(name, fetcher, { force = false } = {}) {
  const file = path.join(ASSET_DIR, `${name}.json`);
  if (!force && mem.has(name)) return mem.get(name);
  let stale = true, data = null;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    stale = Date.now() - fs.statSync(file).mtimeMs > MAX_AGE;
  } catch {}
  if (data && !stale && !force) { mem.set(name, data); return data; }
  try {
    const fresh = await fetcher();
    fs.mkdirSync(ASSET_DIR, { recursive: true });
    writeFileAtomic(file, JSON.stringify(fresh));
    data = fresh;
  } catch (err) {
    if (!data) throw new Error(`Game data (${name}) could not be loaded from valorant-api.com: ${err.message}`);
  }
  mem.set(name, data);
  return data;
}
const get = async (p) => {
  const r = await fetch(BASE + p, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`valorant-api.com ${r.status}`);
  return (await r.json()).data;
};

export async function maps(opts) {
  return cached('maps', async () => (await get('/maps')).filter((m) => m.displayName).map((m) => ({
    name: m.displayName, uuid: m.uuid, minimap: m.displayIcon, splash: m.splash, list: m.listViewIcon, tall: m.listViewIconTall || null,
    xm: m.xMultiplier, ym: m.yMultiplier, xa: m.xScalarToAdd, ya: m.yScalarToAdd,
    callouts: (m.callouts || []).map((c) => ({ super: c.superRegionName, region: c.regionName, x: c.location.x, y: c.location.y })),
  })), opts);
}
export async function mapByName(name) {
  const n = String(name || '').toLowerCase();
  let m = (await maps()).find((x) => x.name.toLowerCase() === n);
  if (!m && n) m = (await maps({ force: true })).find((x) => x.name.toLowerCase() === n);   // a new map: refresh once
  return m || null;
}

export async function agents(opts) {
  return cached('agents', async () => (await get('/agents?isPlayableCharacter=true')).map((a) => ({
    id: a.uuid.toLowerCase(), name: a.displayName, role: a.role ? a.role.displayName : null, icon: a.displayIcon,
  })), opts);
}
let roleMap = null;
// agent id → { name, role }; refreshed once when an agent is unknown (new agent)
export async function roles() {
  if (roleMap) return roleMap;
  roleMap = new Map((await agents()).map((a) => [a.id, a]));
  return roleMap;
}
export async function roleOf(agentId) {
  const r = await roles();
  if (agentId && !r.has(agentId)) { roleMap = new Map((await agents({ force: true })).map((a) => [a.id, a])); }
  return (roleMap.get(agentId) || {}).role || null;
}

export async function tiers(opts) {
  return cached('tiers', async () => {
    const list = await get('/competitivetiers');
    const latest = list[list.length - 1];
    return latest.tiers.filter((t) => t.tierName && !/unused/i.test(t.tierName)).map((t) => ({
      // "ASCENDANT 3" → "Ascendant 3"
      id: t.tier, name: String(t.tierName).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()), color: `#${String(t.color || 'ffffffff').slice(0, 6)}`, icon: t.largeIcon || t.smallIcon || null,
    }));
  }, opts);
}

export async function weapons(opts) {
  return cached('weapons', async () => (await get('/weapons')).map((w) => ({ id: w.uuid.toLowerCase(), name: w.displayName, icon: w.killStreamIcon || null })), opts);
}
let weaponMap = null;
export async function weaponTable() {
  if (weaponMap) return weaponMap;
  try { weaponMap = new Map((await weapons()).map((w) => [w.id, w.name])); } catch { weaponMap = new Map(); }
  return weaponMap;
}

export async function bundle() {
  const [m, a, t, w] = await Promise.all([maps().catch(() => []), agents().catch(() => []), tiers().catch(() => []), weapons().catch(() => [])]);
  return {
    maps: m.map((x) => ({ name: x.name, minimap: x.minimap, splash: x.splash, list: x.list })),
    agents: a, tiers: t, weapons: w,
  };
}
