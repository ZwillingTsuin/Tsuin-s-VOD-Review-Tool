// HenrikDev API (https://docs.henrikdev.xyz). One queue with priorities USER > SYNC > BG, so a click never waits behind
// background downloads. Spacing follows the key's limit from the response headers (Basic: 30/min).
const API = 'https://api.henrikdev.xyz/valorant';
export const P = { USER: 0, SYNC: 1, BG: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HenrikError extends Error {
  constructor(message, status = null) { super(message); this.status = status; }
}

export function createHenrik(getKey) {
  const queue = [[], [], []];
  const limits = { limit: 30, remaining: null, resetAt: 0 };
  const state = { ok: null, error: null, lastAt: null };
  let pumping = false, nextAt = 0;
  const spacing = () => Math.ceil((60000 / Math.max(1, limits.limit)) * 1.1);

  async function call(p) {
    const key = getKey();
    if (!key) throw new HenrikError('No HenrikDev API key yet. Add it in Settings.', 401);
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      try {
        r = await fetch(API + p, { headers: { Authorization: key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      } catch (err) {
        if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        state.ok = false; state.error = `Could not reach HenrikDev (${err.name === 'TimeoutError' ? 'timeout' : err.message})`;
        throw new HenrikError(state.error);
      }
      const lim = Number(r.headers.get('x-ratelimit-limit')), rem = Number(r.headers.get('x-ratelimit-remaining')), reset = Number(r.headers.get('x-ratelimit-reset'));
      if (lim > 0) limits.limit = lim;
      if (Number.isFinite(rem) && r.headers.has('x-ratelimit-remaining')) { limits.remaining = rem; limits.resetAt = Date.now() + (Number.isFinite(reset) ? reset : 60) * 1000; }
      if (r.status === 429 && attempt < 2) { await sleep((Number.isFinite(reset) && reset > 0 ? reset : 30) * 1000); continue; }
      if (r.status >= 500 && attempt < 2) { await sleep(3000 * (attempt + 1)); continue; }
      const body = await r.json().catch(() => null);
      state.lastAt = Date.now();
      if (!r.ok) {
        const msg = body && body.errors && body.errors[0] && (body.errors[0].message || body.errors[0].details);
        const text = r.status === 401 || r.status === 403 ? 'The HenrikDev API key was not accepted. Check it in Settings.'
          : `HenrikDev ${r.status}${msg ? `: ${msg}` : ''}`;
        // a 404 on one account / match is about that request, not about the key
        if (r.status !== 404) { state.ok = false; state.error = text; }
        throw new HenrikError(text, r.status);
      }
      state.ok = true; state.error = null;
      return body;
    }
    throw new HenrikError('HenrikDev is not answering, try again later.');
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.some((q) => q.length)) {
        let wait = nextAt - Date.now();
        if (limits.remaining != null && limits.remaining <= 1 && limits.resetAt > Date.now()) wait = Math.max(wait, limits.resetAt - Date.now());
        if (wait > 0) await sleep(wait);
        // picked after the wait, so a user request that arrived meanwhile goes first
        const job = queue[0].shift() || queue[1].shift() || queue[2].shift();
        try { job.resolve(await call(job.p)); } catch (err) { job.reject(err); }
        nextAt = Date.now() + spacing();
      }
    } finally { pumping = false; }
  }

  // raw: the whole response body ({ data, results, … }); otherwise body.data
  function get(p, { prio = P.SYNC, raw = false } = {}) {
    return new Promise((resolve, reject) => {
      queue[prio].push({ p, resolve: (b) => resolve(raw ? b : b && b.data), reject });
      pump();
    });
  }

  // outside the queue: Settings → Test
  async function test(key) {
    const r = await fetch(`${API}/v1/status/eu`, { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) }).catch((err) => ({ ok: false, status: 0, err }));
    if (r.err) return { ok: false, error: `Could not reach HenrikDev (${r.err.message})` };
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'This key was not accepted.' };
    if (!r.ok && r.status !== 404) return { ok: false, error: `HenrikDev answered ${r.status}. Try again in a minute.` };
    return { ok: true, limit: Number(r.headers.get('x-ratelimit-limit')) || null };
  }

  const status = () => ({ ...state, queue: { user: queue[0].length, sync: queue[1].length, background: queue[2].length }, limit: limits.limit, remaining: limits.remaining });
  return { get, test, status };
}
