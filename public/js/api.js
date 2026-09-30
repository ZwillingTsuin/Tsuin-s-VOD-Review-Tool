// Writes carry X-VRT: the server refuses writes without it (other websites can't send it).
async function call(method, url, body) {
  const opts = { method, headers: {} };
  if (method !== 'GET') opts.headers['X-VRT'] = '1';
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error('The app is not running. Start it again (Start.bat) and reload this page.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body = {}) => call('POST', url, body),
  patch: (url, body = {}) => call('PATCH', url, body),
  put: (url, body = {}) => call('PUT', url, body),
  del: (url) => call('DELETE', url),
};

// kept with the app's data, so they survive a browser change
let prefs = null;
export async function loadPrefs() { if (!prefs) prefs = await api.get('/api/prefs').catch(() => ({})); return prefs; }
export function pref(key, fallback = null) { return prefs && prefs[key] !== undefined ? prefs[key] : fallback; }
export function setPref(key, value) { if (prefs) prefs[key] = value; api.patch('/api/prefs', { [key]: value }).catch(() => {}); }
