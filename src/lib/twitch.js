// Twitch Helix, read-only (public VOD lists, channel search) with an app token: no user login involved.

// "3h36m28s" / "58m2s" / "40s" → seconds
export function durSecs(d) {
  const m = String(d || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
}

const requestToken = (clientId, clientSecret) => fetch('https://id.twitch.tv/oauth2/token', {
  method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }), signal: AbortSignal.timeout(15000),
});

export function createTwitch(getCreds) {
  let token = null, tokenUntil = 0, tokenFor = null;
  const enabled = () => { const c = getCreds(); return !!(c.clientId && c.clientSecret); };

  async function auth() {
    const { clientId, clientSecret } = getCreds();
    if (token && Date.now() < tokenUntil && tokenFor === clientId) return token;
    const r = await requestToken(clientId, clientSecret);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Twitch did not accept the Client ID / Secret (${r.status}${j.message ? ': ' + j.message : ''}).`);
    token = j.access_token; tokenFor = clientId;
    tokenUntil = Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000;
    return token;
  }

  async function helix(pathAndQuery, retry = true) {
    if (!enabled()) throw new Error('No Twitch key yet. Add it in Settings.');
    const r = await fetch('https://api.twitch.tv/helix/' + pathAndQuery, {
      headers: { 'Client-Id': getCreds().clientId, Authorization: 'Bearer ' + (await auth()) }, signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401 && retry) { token = null; return helix(pathAndQuery, false); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twitch ${r.status}${j.message ? ': ' + j.message : ''}`);
    return j;
  }

  // → [{ id, start (ISO), dur (s), title, retention (days) }]
  const avatars = new Map();   // channel → profile picture URL, noted whenever a channel is looked up
  async function vods(login) {
    const u = await helix('users?login=' + encodeURIComponent(login));
    const user = (u.data || [])[0];
    if (!user) throw new Error(`No Twitch channel "${login}"`);
    if (user.profile_image_url) avatars.set(login, user.profile_image_url);
    const retention = user.broadcaster_type === 'partner' ? 60 : user.broadcaster_type === 'affiliate' ? 14 : 7;
    const out = [];
    let cursor = null;
    for (let page = 0; page < 3; page++) {
      const j = await helix(`videos?user_id=${user.id}&type=archive&first=100${cursor ? '&after=' + cursor : ''}`);
      // the exact stream start is in the thumbnail path (…_<login>_<streamId>_<unix start>/); created_at is a few seconds later
      for (const v of j.data || []) {
        const m = String(v.thumbnail_url || '').match(/_\d{9,}_(\d{10})\//);
        out.push({ id: v.id, start: m ? new Date(Number(m[1]) * 1000).toISOString() : v.created_at, dur: durSecs(v.duration), title: v.title, retention });
      }
      cursor = j.pagination && j.pagination.cursor;
      if (!cursor || !(j.data || []).length) break;
    }
    return out;
  }

  async function search(q) {
    const j = await helix('search/channels?first=8&query=' + encodeURIComponent(q));
    return (j.data || []).map((c) => ({ login: c.broadcaster_login, name: c.display_name, live: !!c.is_live, game: c.game_name || '' }));
  }

  async function test({ clientId, clientSecret }) {
    try {
      const r = await requestToken(clientId, clientSecret);
      const j = await r.json().catch(() => ({}));
      return r.ok && j.access_token ? { ok: true } : { ok: false, error: `Twitch did not accept these (${j.message || r.status}).` };
    } catch (err) { return { ok: false, error: `Could not reach Twitch (${err.message})` }; }
  }

  return { enabled, vods, search, test, avatarOf: (login) => avatars.get(login) || null };
}
