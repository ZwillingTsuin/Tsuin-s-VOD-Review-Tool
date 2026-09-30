// minimap position 0..1 (the displayIcon image); Riot swaps x and y for the minimap
export function toMinimap(map, loc) {
  if (!map || !loc) return null;
  return { u: loc.y * map.xm + map.xa, v: loc.x * map.ym + map.ya };
}

export const calloutName = (c) => (/spawn/i.test(c.super) ? c.super.replace(' Side', ' spawn') : `${c.super} ${c.region}`);

// nearest named callout, e.g. "A Main"; spawns keep their long names
export function calloutAt(map, loc) {
  if (!map || !loc || !map.callouts || !map.callouts.length) return null;
  let best = null, bd = Infinity;
  for (const c of map.callouts) {
    const d = (c.x - loc.x) ** 2 + (c.y - loc.y) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return null;
  const name = /spawn/i.test(best.super) ? best.super.replace(' Side', '') : `${best.super} ${best.region}`;
  return { name, zone: best.super };
}

// "How far forward": position projected on the line attacker spawn → defender spawn, 0 = own spawn, 1 = enemy spawn
export function spaceIndex(map, loc, side) {
  if (!map || !loc || !map.callouts) return null;
  const a = map.callouts.find((c) => /attacker/i.test(c.super)), d = map.callouts.find((c) => /defender/i.test(c.super));
  if (!a || !d) return null;
  const vx = d.x - a.x, vy = d.y - a.y, len2 = vx * vx + vy * vy;
  const t = Math.max(0, Math.min(1, ((loc.x - a.x) * vx + (loc.y - a.y) * vy) / len2));
  return side === 'defense' ? 1 - t : t;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
export function mapInfo(map) {
  if (!map) return null;
  return {
    // through the app: cached for offline use, and same-origin so a drawing on it can be exported as a picture
    name: map.name, minimap: map.uuid ? `/api/minimap/${map.uuid}` : map.minimap,
    callouts: (map.callouts || []).map((c) => { const uv = toMinimap(map, c); return { name: calloutName(c), zone: c.super, region: c.region, uv: uv ? [r3(uv.u), r3(uv.v)] : null }; }),
  };
}
