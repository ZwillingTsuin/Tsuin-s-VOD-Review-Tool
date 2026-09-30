// Handlers return a value (sent as JSON) or respond themselves; throwing an HttpError sets the status.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export function router() {
  const routes = [];
  // opts.bodyLimit in bytes (default 2 MB); opts.raw: the body as a Buffer
  const add = (method) => (pattern, fn, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, fn, limit: opts.bodyLimit, raw: !!opts.raw });
  };
  async function handle(req, res, url) {
    for (const r of routes) {
      if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      req.query = Object.fromEntries(url.searchParams);
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') req.body = r.raw ? await readRaw(req, r.limit) : await readJson(req, r.limit);
      else req.body = {};
      const out = await r.fn(req, res, params);
      if (!res.headersSent && !res.writableEnded) sendJson(res, 200, out === undefined ? { ok: true } : out);
      return true;
    }
    return false;
  }
  return { get: add('GET'), post: add('POST'), patch: add('PATCH'), put: add('PUT'), del: add('DELETE'), handle };
}

function readRaw(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'That file is too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Too much data')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
