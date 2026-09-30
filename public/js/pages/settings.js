// The setup guide reuses these sections.
import { api } from '../api.js';
import { h, put, help, toast, ask, ago, fill } from '../ui.js';
import { icon } from '../icons.js';
import { tierImg } from '../assets.js';

const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text, ' ', icon('external', 12));
const status = (el, ok, text) => fill(el, h('span', { class: `status-line ${ok ? 'good' : ok === false ? 'bad' : 'muted'}` }, ok ? icon('check', 13) : ok === false ? icon('warn', 13) : h('i', { class: 'spinner' }), text));
// "https://www.twitch.tv/s0mcs" or "twitch.tv/s0mcs/videos" → "s0mcs"
export const twitchName = (s) => String(s || '').trim().replace(/^.*twitch\.tv\//i, '').split(/[/?#]/)[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
const done = (text, onChange, label = 'Change') => h('div', { class: 'done-line' }, h('span', { class: 'good row-i' }, icon('check', 15), text), h('span', { class: 'grow' }), h('button', { class: 'quiet small', onclick: onChange }, label));

export async function render(root) {
  const s = await api.get('/api/settings');
  put(root, h('div', { class: 'page-head' }, h('h1', {}, 'Settings')),
    h('div', { class: 'settings' },
      henrikSection(s), accountsSection(), twitchSection(s), prosSection(), recordingsSection(s), categoriesSection(s), dataFolderSection(), privacySection(),
      h('p', { class: 'small muted' }, `VOD Review Tool ${s.version}`)));
}

export function henrikSection(s, { onSaved } = {}) {
  const box = h('section', { class: 'card set' });
  let saved = !!s.henrikKey, masked = s.henrikKey, editing = !saved;
  function paint() {
    const head = h('div', { class: 'set-head' }, icon('key', 16), h('h2', {}, 'HenrikDev API key'), h('span', { class: 'tag req' }, 'required'));
    if (!editing) { fill(box, head, done(`Connected (${masked})`, () => { editing = true; paint(); }, 'Use another key')); return; }
    const input = h('input', { type: 'password', placeholder: 'HDEV-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'HenrikDev API key' });
    const out = h('div', { class: 'small' });
    const btn = h('button', { class: 'primary' }, 'Test & save');
    const save = async () => {
      const key = input.value.trim();
      if (!key) { status(out, false, 'Paste your key first'); input.focus(); return; }
      btn.disabled = true; status(out, null, 'Checking the key with HenrikDev…');
      const t = await api.post('/api/settings/test-henrik', { key }).catch((err) => ({ ok: false, error: err.message }));
      if (!t.ok) { btn.disabled = false; status(out, false, t.error); return; }
      try { await api.patch('/api/settings', { henrikKey: key }); } catch (err) { btn.disabled = false; status(out, false, err.message); return; }
      saved = true; editing = false; masked = `${key.slice(0, 4)}…${key.slice(-4)}`;
      status(out, true, `Works${t.limit ? ` (${t.limit} requests per minute)` : ''}. Saved.`);
      setTimeout(() => { paint(); onSaved && onSaved(); }, 900);
    };
    btn.onclick = save;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    fill(box, head,
      h('p', { class: 'muted' }, 'Your matches come from the HenrikDev API (a free, unofficial VALORANT API). Getting a key takes about two minutes:'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Open the ', ext('https://api.henrikdev.xyz/dashboard/', 'HenrikDev dashboard'), ' and log in (with Discord).'),
        h('li', {}, 'Go to ', h('b', {}, 'API Keys'), ' in the menu on the left and generate a new key: product ', h('b', {}, 'VALORANT'), ', type ', h('b', {}, 'Basic'), '. You get it right away.'),
        h('li', {}, 'Copy the key (it starts with ', h('code', {}, 'HDEV-'), ') and paste it here.')),
      h('p', { class: 'small muted' }, 'Doesn\'t work? Their Discord gives keys too: join ', ext('https://discord.com/invite/X3GaVkX2YN', 'the HenrikDev Discord'), ', go to ', h('b', {}, '#get-a-key'), ' and pick VALORANT (Basic Key).'),
      h('div', { class: 'row' }, input, btn), out,
      saved ? h('button', { class: 'quiet small', onclick: () => { editing = false; paint(); } }, 'Keep the saved key') : null,
      h('p', { class: 'small muted' }, 'The basic key allows 30 requests per minute, so the first download of your match history takes a while (about 2 s per match). It runs in the background. The key stays on this PC.'));
    input.focus();
  }
  paint();
  return box;
}

export function accountsSection({ onChange } = {}) {
  const list = h('div', { class: 'acc-list' });
  const input = h('input', { placeholder: 'Name#TAG', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Riot ID', maxlength: 24 });
  const out = h('div', { class: 'small' });
  let timer = null;
  const load = async () => {
    const accs = await api.get('/api/accounts').catch(() => []);
    fill(list, accs.length ? accs.map((a) => h('div', { class: 'acc' },
      tierImg(a.rank && a.rank.tierId, 'tier-sm'),
      h('div', { class: 'acc-main' }, h('b', {}, a.riotId), h('span', { class: 'small muted row-i' },
        a.syncing ? [h('i', { class: 'spinner' }), a.matches ? `Reading your match history… ${a.matches} matches so far` : 'Reading your match history…']
          : [a.rank ? `${a.rank.tier}${a.rank.tierId > 2 ? ` · ${a.rank.rr} RR` : ''}` : 'Unranked', `${a.matches} matches`, a.region ? a.region.toUpperCase() : null, a.checkedAt ? `checked ${ago(new Date(a.checkedAt).toISOString())}` : null].filter(Boolean).join(' · ')),
        a.error ? h('span', { class: 'small bad' }, a.error) : null),
      h('label', { class: 'switch small', 'data-tip': 'Counted in Insights. Switch it off for a smurf in lower lobbies: its games would skew your numbers.' },
        h('input', { type: 'checkbox', checked: a.inInsights, onchange: (e) => api.patch(`/api/accounts/${a.id}`, { inInsights: e.target.checked }) }), 'In Insights'),
      h('button', { class: 'quiet icon-btn', 'aria-label': `Check ${a.riotId} for new games`, 'data-tip': 'Check for new games now', onclick: async (e) => {
        const b = e.currentTarget; b.classList.add('spin'); b.disabled = true;
        try { const r = await api.post(`/api/accounts/${a.id}/refresh`); toast(r.added ? `${r.added} new match${r.added > 1 ? 'es' : ''}` : `${a.riotId} is up to date`); load(); }
        catch (err) { toast(err.message, 'bad'); } finally { b.classList.remove('spin'); b.disabled = false; }
      } }, icon('refresh', 14)),
      h('button', { class: 'quiet icon-btn', 'aria-label': `Remove ${a.riotId}`, onclick: async () => {
        if (!(await ask(`Remove ${a.riotId}? Its matches leave the list (your notes stay).`, { ok: 'Remove', danger: true }))) return;
        await api.del(`/api/accounts/${a.id}`); load();
      } }, icon('trash', 14)))) : h('p', { class: 'muted small' }, 'No account yet.'));
    onChange && onChange(accs);
    clearTimeout(timer);
    if (accs.some((a) => a.syncing) && document.body.contains(list)) timer = setTimeout(load, 3000);
  };
  const addBtn = h('button', { class: 'primary' }, icon('plus', 14), 'Add');
  const add = async () => {
    const id = input.value.trim();
    if (!/^.+#.+$/.test(id)) { status(out, false, 'A Riot ID looks like Name#TAG'); input.focus(); return; }
    addBtn.disabled = true; status(out, null, 'Looking it up…');
    try { await api.post('/api/accounts', { riotId: id }); input.value = ''; status(out, true, 'Added. Its match history is read now, then the matches download in the background.'); load(); }
    catch (err) { status(out, false, err.message); }
    finally { addBtn.disabled = false; }
  };
  addBtn.onclick = add;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  load();
  return h('section', { class: 'card set' },
    h('div', { class: 'set-head' }, icon('user', 16), h('h2', {}, 'Your Riot accounts'), h('span', { class: 'tag req' }, 'at least one')),
    h('p', { class: 'muted' }, 'Your Riot ID as it shows in the game (Name#TAG). Add every account you play on. If you change your name later, the app follows it by itself.'),
    list, h('div', { class: 'row' }, input, addBtn), out);
}

export function twitchSection(s, { onChannelSaved, setup = false } = {}) {
  const box = h('section', { class: 'card set' });
  let connected = !!(s.twitchClientId && s.twitchSecret), editing = !connected;
  function paint() {
    const head = h('div', { class: 'set-head' }, icon('film', 16), h('h2', {}, 'Twitch'), h('span', { class: 'tag' }, 'optional'));
    const keys = editing ? keyForm() : done('Connected: pro VODs and your streams are checked every 2 hours', () => { editing = true; paint(); }, 'Enter new keys');
    fill(box, head,
      editing ? h('p', { class: 'muted' }, 'Needed for pro VODs (matched to their games) and for reviewing your own streams. Everything else works without it.') : null,
      keys, channelPart());
  }
  function keyForm() {
    const id = h('input', { placeholder: 'Client ID', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Twitch Client ID' });
    const secret = h('input', { type: 'password', placeholder: 'Client Secret', autocomplete: 'off', 'aria-label': 'Twitch Client Secret' });
    const out = h('div', { class: 'small' });
    const btn = h('button', { class: 'primary' }, 'Test & save');
    btn.onclick = async () => {
      const body = { clientId: id.value.trim(), clientSecret: secret.value.trim() };
      if (!body.clientId || !body.clientSecret) { status(out, false, 'Both the Client ID and the Client Secret are needed'); return; }
      btn.disabled = true; status(out, null, 'Checking with Twitch…');
      const t = await api.post('/api/settings/test-twitch', body).catch((err) => ({ ok: false, error: err.message }));
      if (!t.ok) { btn.disabled = false; status(out, false, t.error); return; }
      await api.patch('/api/settings', { twitchClientId: body.clientId, twitchSecret: body.clientSecret });
      status(out, true, 'Works. Saved.');
      connected = true; editing = false;
      setTimeout(paint, 800);
    };
    return h('div', { class: 'col-stack' },
      h('details', { class: 'howto', open: setup }, h('summary', {}, icon('info', 14), 'How to get a Client ID and Secret (about 3 minutes)', help('A step-by-step guide. Click to open or close it.')),
        h('ol', { class: 'steps' },
          h('li', {}, 'Twitch needs two-factor authentication on your account for this: Twitch → Settings → Security and Privacy → Set Up Two-Factor Authentication.'),
          h('li', {}, 'Open the ', ext('https://dev.twitch.tv/console/apps', 'Twitch developer console'), ' and log in with your Twitch account.'),
          h('li', {}, h('b', {}, 'Register Your Application'), ': any unique name (e.g. vod-review-yourname), OAuth Redirect URL ', h('code', {}, 'http://localhost'), ' (click Add), any category (e.g. ', h('b', {}, 'Other'), '), Client Type ', h('b', {}, 'Confidential'), '. Create.'),
          h('li', {}, 'Click ', h('b', {}, 'Manage'), ' next to it: copy the ', h('b', {}, 'Client ID'), ', then click ', h('b', {}, 'New Secret'), ' and copy the secret (it is shown once).'),
          h('li', {}, 'Paste both here. The app only reads public VOD lists; it never logs into your Twitch account.'))),
      h('div', { class: 'row' }, id, secret, btn), out,
      connected ? h('button', { class: 'quiet small', onclick: () => { editing = false; paint(); } }, 'Keep the saved keys') : null);
  }
  function channelPart() {
    const channel = h('input', { value: s.myTwitch || '', placeholder: 'Your channel name or link (only if you stream)', 'aria-label': 'Your Twitch channel', spellcheck: 'false' });
    const out = h('div', { class: 'small' });
    const save = async () => {
      const name = twitchName(channel.value);
      channel.value = name;
      await api.patch('/api/settings', { myTwitch: name || null });
      s.myTwitch = name || null;
      status(out, true, name ? 'Saved. Your VODs are matched to your games.' : 'Saved without a channel.');
      onChannelSaved && setTimeout(onChannelSaved, 700);
    };
    channel.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    return h('div', { class: 'set-sub-wrap' },
      h('div', { class: 'set-sub' }, h('b', {}, 'Your channel'), help('If you stream: your VODs are matched to your games, and a match with a VOD opens straight into the Twitch review.')),
      h('div', { class: 'row' }, channel, h('button', { class: setup ? 'primary' : '', onclick: save }, setup ? 'Save & continue' : 'Save')), out);
  }
  paint();
  return box;
}

export function prosSection({ compact = false } = {}) {
  const list = h('div', { class: 'pro-list' });
  let timer = null;
  const load = async () => {
    const [pros, st] = await Promise.all([api.get('/api/pros').catch(() => []), api.get('/api/status').catch(() => null)]);
    const syncing = st && st.pros.running ? st.pros.current : null;
    fill(list, pros.length ? pros.map((p) => proRow(p, syncing === p.id || (st && st.pros.running && !p.matches))) : h('p', { class: 'muted small' }, 'No pros yet.'));
    clearTimeout(timer);
    if (st && (st.pros.running || st.backfill.running) && document.body.contains(list)) timer = setTimeout(load, 4000);
  };
  function proRow(p, busy) {
    const row = h('div', { class: 'pro' });
    const view = () => fill(row,
      p.twitchAvatar ? h('img', { class: 'tw-avatar big', src: p.twitchAvatar, alt: '', width: 34, height: 34 }) : h('span', { class: 'tw-avatar big blank' }),
      h('div', { class: 'pro-main' }, h('b', {}, p.name),
        h('span', { class: 'small muted' }, p.accounts.map((a) => a.riotId).join(', ')),
        busy ? h('span', { class: 'small muted row-i' }, h('i', { class: 'spinner' }), p.matches ? `${p.matches} matches found, downloading them (${p.downloaded} so far)` : 'Looking up their accounts and matches…')
          : h('span', { class: 'small muted' }, [`${p.downloaded}/${p.matches} matches downloaded`, p.twitch ? `twitch.tv/${p.twitch}` : 'no Twitch channel', p.twitch ? (p.delayChecked ? `stream delay ${p.vodDelay} s` : 'stream delay not set yet') : null, `${p.plays} plays`].filter(Boolean).join(' · ')),
        p.accounts.filter((a) => a.error).map((a) => h('span', { class: 'small bad' }, `${a.riotId}: ${a.error}`))),
      h('button', { class: 'quiet icon-btn', 'aria-label': `Edit ${p.name}`, onclick: edit }, icon('pencil', 14)),
      h('button', { class: 'quiet icon-btn', 'aria-label': `Remove ${p.name}`, onclick: async () => {
        if (!(await ask(`Remove ${p.name}? Their plays leave Pro review (your notes on reviewed plays stay).`, { ok: 'Remove', danger: true }))) return;
        await api.del(`/api/pros/${p.id}`); load();
      } }, icon('trash', 14)));
    function edit() {
      fill(row, proForm(p, async (body) => { await api.patch(`/api/pros/${p.id}`, body); toast('Saved'); load(); }, view));
    }
    view();
    return row;
  }
  const addBox = h('div', { class: 'pro-add' });
  const addBtn = h('button', { onclick: () => openAdd() }, icon('plus', 14), 'Add a pro');
  const openAdd = () => fill(addBox, proForm(null, async (body) => { await api.post('/api/pros', body); toast('Added. Looking up their matches now.'); fill(addBox, addBtn); load(); }, () => fill(addBox, addBtn)));
  addBox.append(addBtn);
  load();
  return h('section', { class: 'card set' },
    h('div', { class: 'set-head' }, icon('star', 16), h('h2', {}, 'Pros you study'), h('span', { class: 'tag' }, 'optional')),
    compact ? null : h('p', { class: 'muted' }, 'Players to learn from. Their newest ranked matches are downloaded and analysed like yours (Insights compares you), and with their Twitch channel their clutches, retakes and site takes show up in Pro review.'),
    list, addBox);
}
function proForm(p, onSave, onCancel) {
  const name = h('input', { value: p ? p.name : '', placeholder: 'Name, e.g. TenZ', maxlength: 40, 'aria-label': 'Name' });
  const ids = h('textarea', { rows: 3, placeholder: 'Riot IDs, one per line (main and alts)\nName#TAG', 'aria-label': 'Riot IDs' }, p ? p.accounts.map((a) => a.riotId).join('\n') : '');
  const twitch = h('input', { value: p && p.twitch ? p.twitch : '', placeholder: 'Twitch channel or link (optional)', 'aria-label': 'Twitch channel' });
  twitch.addEventListener('change', () => { twitch.value = twitchName(twitch.value); });
  const limit = h('input', { type: 'number', min: 20, max: 1000, step: 10, value: p ? p.matchLimit : 150, 'aria-label': 'Matches per account', class: 'num-in' });
  const found = h('div', { class: 'found' });
  const out = h('div', { class: 'small' });
  const search = async () => {
    const q = twitchName(twitch.value) || name.value.trim();
    if (!q) return;
    fill(found, h('span', { class: 'small muted' }, 'Searching Twitch…'));
    try {
      const list = await api.get('/api/twitch/search?q=' + encodeURIComponent(q));
      fill(found, list.length ? list.map((c) => h('button', { class: 'chip small', type: 'button', onclick: () => { twitch.value = c.login; fill(found); } }, c.live ? h('i', { class: 'live-dot' }) : null, c.name, h('span', { class: 'n' }, c.game || ''))) : h('span', { class: 'small muted' }, 'No channel found'));
    } catch (err) { fill(found, h('span', { class: 'small bad' }, err.message)); }
  };
  const saveBtn = h('button', { class: 'primary', type: 'button' }, p ? 'Save' : 'Add');
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try { await onSave({ name: name.value, riotIds: ids.value.split('\n').map((x) => x.trim()).filter(Boolean), twitch: twitchName(twitch.value) || null, matchLimit: Number(limit.value) || 150 }); }
    catch (err) { status(out, false, err.message); saveBtn.disabled = false; }
  };
  return h('div', { class: 'pro-form' },
    h('div', { class: 'row' }, name, twitch, h('button', { type: 'button', class: 'quiet', onclick: search }, icon('search', 14), 'Find on Twitch')), found, ids,
    h('div', { class: 'row' }, h('label', { class: 'small muted row-i' }, 'Newest', limit, 'matches per account'),
      h('span', { class: 'small muted' }, 'Riot IDs: tracker.gg, their stream overlay or socials.'), h('span', { class: 'grow' }),
      h('button', { class: 'quiet', type: 'button', onclick: onCancel }, 'Cancel'), saveBtn), out);
}

function recordingsSection(s) {
  const dir = h('input', { value: s.recordingsDir || '', placeholder: s.recordingsSuggestion ? `e.g. ${s.recordingsSuggestion}` : 'The folder your recordings go to', 'aria-label': 'Recordings folder', spellcheck: 'false' });
  const out = h('div', { class: 'small' });
  const save = async () => {
    try { await api.patch('/api/settings', { recordingsDir: dir.value.trim() }); } catch (err) { status(out, false, err.message); return; }
    if (!dir.value.trim()) { status(out, true, 'No recordings folder: nothing is read.'); return; }
    const r = await api.get('/api/recordings');
    status(out, r.exists, r.exists ? `${r.files.length} video${r.files.length === 1 ? '' : 's'} found` : 'This folder does not exist');
  };
  const suggest = s.recordingsSuggestion && !s.recordingsDir
    ? h('button', { class: 'quiet small', onclick: () => { dir.value = s.recordingsSuggestion; save(); } }, `Use ${s.recordingsSuggestion}`) : null;
  return h('section', { class: 'card set' },
    h('div', { class: 'set-head' }, icon('film', 16), h('h2', {}, 'Your recordings'), h('span', { class: 'tag' }, 'optional')),
    h('p', { class: 'muted' }, 'The folder your recordings go to (OBS, Medal, Outplayed, ShadowPlay …). A match review can use a recording from here; the one that ran during the match is suggested. Only this folder is read (the video files in it), and nothing leaves your PC. Without a folder nothing is read.'),
    h('div', { class: 'row' }, dir, h('button', { onclick: save }, 'Save & check'), suggest), out,
    h('p', { class: 'small muted' }, 'MP4 plays everywhere. OBS records MKV by default: File → Remux Recordings turns it into MP4, or set OBS to record MP4 / fragmented MP4.'));
}

function categoriesSection(s) {
  const ta = h('textarea', { rows: 4, 'aria-label': 'Focuses' }, s.categories.join('\n'));
  const out = h('div', { class: 'small' });
  return h('section', { class: 'card set' },
    h('div', { class: 'set-head' }, icon('tag', 16), h('h2', {}, 'Your focuses')),
    h('p', { class: 'muted' }, 'What your notes and ratings are sorted by, one per line. You can also change them right in a review.'),
    ta, h('div', { class: 'row' }, h('button', { onclick: async () => { await api.patch('/api/settings', { categories: ta.value.split('\n') }); status(out, true, 'Saved'); } }, 'Save')), out);
}

export function privacySection() {
  const item = (ico, title, ...text) => h('li', {}, icon(ico, 16), h('div', {}, h('b', {}, title), h('p', { class: 'muted' }, ...text)));
  return h('section', { class: 'card set' },
    h('div', { class: 'set-head' }, icon('shield', 16), h('h2', {}, 'What the app does on your PC')),
    h('ul', { class: 'facts' },
      item('shield', 'It runs only on this PC.', `Start.bat starts a small server (Node.js) that only the browser on this PC can reach, at localhost:${location.port || 3710}. Nothing is opened to your network or the internet. No installation, no admin rights, nothing added to Windows startup.`),
      item('power', 'It stops by itself.', 'About 45 minutes after you close its last tab (once nothing is downloading anymore), or right away with the power button at the top right. Start.bat starts it again.'),
      item('folder', 'It only touches its own folders.', 'It writes only to its data folder. A recordings folder is read only if you set one in Settings, and only the video files in it. It doesn\'t look anywhere else on your PC.'),
      item('external', 'It talks to three services.', 'HenrikDev (match data, with your key), valorant-api.com (maps and agent, rank and weapon pictures) and, only with Twitch keys, Twitch (the public VOD lists of the channels you add). Your browser loads those pictures too, and the Twitch or YouTube player when you watch a video.'),
      item('eyeOff', 'It never', 'logs into your Riot or Twitch account, sends anything to its developer or anyone else, collects usage data, updates itself, or starts other programs (apart from your browser, and Explorer when you click "Open folder").'),
      item('key', 'Your keys', 'are saved in the data folder, sent only to HenrikDev and Twitch, and left out of backups. Like most app settings they are stored as plain text, so don\'t share the data folder itself.')),
    h('p', { class: 'small muted' }, 'All of the app is readable in its folder: Start.bat is a short text file, the rest is plain JavaScript. Nothing is downloaded and run later.'));
}

const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
export function dataFolderSection({ setup = false } = {}) {
  const box = h('section', { class: 'card set' });
  let changing = false;
  async function paint() {
    const d = await api.get('/api/data-folder').catch(() => null);
    const head = h('div', { class: 'set-head' }, icon('folder', 16), h('h2', {}, setup ? 'Where your data is saved' : 'Your data'));
    if (!d) { fill(box, head, h('p', { class: 'bad' }, 'The data folder could not be read.')); return; }
    const open = h('button', { class: 'quiet small', onclick: () => api.post('/api/data-folder/open').catch((err) => toast(err.message, 'bad')) }, icon('external', 13), 'Open folder');
    const change = d.pinned ? null : h('button', { class: 'quiet small', onclick: () => { changing = !changing; paint(); } }, changing ? 'Cancel' : 'Change…');
    fill(box, head,
      h('div', { class: 'row data-path' }, h('code', { class: 'path grow' }, d.dir), open, change),
      h('p', { class: 'small muted' }, `Your settings and keys, reviews, notes, screenshots and the downloaded matches${d.matches ? ` (${d.matches} matches, ${mb(d.size)} in all)` : ''}. Updating the app never touches this folder.`),
      d.pinned ? h('p', { class: 'small muted' }, 'Set by the start command (--data), so it can\'t be changed here.') : null,
      !d.isDefault && !d.pinned ? h('p', { class: 'small muted' }, 'Moved from the default folder: a small file there (', h('code', {}, 'data-folder.json'), ') remembers where it is now.') : null,
      changing ? changeForm(d) : null,
      setup ? null : backupRow());
  }
  function changeForm(d) {
    const input = h('input', { value: d.isDefault ? '' : d.defaultDir, placeholder: 'e.g. D:\\VOD Review Tool', spellcheck: 'false', 'aria-label': 'New data folder' });
    const out = h('div', { class: 'small col-stack' });
    let timer = null, seq = 0;
    const check = async () => {
      const my = ++seq, dir = input.value.trim();
      if (!dir) { fill(out); return; }
      const c = await api.post('/api/data-folder/check', { dir }).catch((err) => ({ error: err.message }));
      if (my !== seq) return;
      if (!c.ok) { status(out, false, c.error); return; }
      const go = h('button', { class: 'primary', onclick: async () => {
        go.disabled = true; input.disabled = true;
        status(out, null, c.state === 'existing' ? 'Switching…' : 'Moving your data. This can take a minute with many matches; keep this tab open.');
        try {
          const r = await api.post('/api/data-folder/move', { dir });
          changing = false;
          await paint();
          toast(r.used ? `Now using the data in ${r.dir}. Your previous data stays in ${r.leftBehind}.` : `Moved to ${r.dir}.`);
        } catch (err) { go.disabled = false; input.disabled = false; status(out, false, err.message); }
      } }, c.state === 'existing' ? 'Use the data that\'s there' : c.isDefault ? 'Move it back' : 'Move my data there');
      fill(out,
        h('p', {}, 'Your data will be in ', h('code', { class: 'path' }, c.dir), c.state === 'existing' ? ': that folder already has data of this app, which is used from now on (your current data stays where it is).' : '.'),
        c.warnings.map((w) => h('p', { class: 'warn-text row-i' }, icon('warn', 13), w)),
        h('div', { class: 'row' }, go));
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 350); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    setTimeout(() => { input.focus(); if (input.value) check(); }, 0);
    return h('div', { class: 'col-stack change-folder' },
      h('p', { class: 'small muted' }, 'Type the folder (it is made if it doesn\'t exist). Your data is copied there and checked, and only then removed here. A folder synced by OneDrive or Dropbox is not a good place for it.'),
      h('div', { class: 'row' }, input, d.isDefault ? null : h('button', { class: 'quiet small', onclick: () => { input.value = d.defaultDir; check(); } }, 'Default folder')), out);
  }
  function backupRow() {
    const file = h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async () => {
      const f = file.files[0]; if (!f) return;
      try { const d = JSON.parse(await f.text()); const r = await api.post('/api/import', d); toast(`Restored: ${Object.values(r.added).reduce((a, b) => a + b, 0)} items`); }
      catch (err) { toast(`Import failed: ${err.message}`, 'bad'); }
      file.value = '';
    } });
    return h('div', { class: 'col-stack' },
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '/api/export', download: '' }, icon('download', 14), 'Download a backup'),
        h('button', { onclick: () => file.click() }, icon('upload', 14), 'Restore a backup'), file),
      h('p', { class: 'small muted' }, 'The backup holds your accounts, pros, reviews, notes and drawings (not the API keys, not the downloaded match data, which comes back by itself).'));
  }
  paint();
  return box;
}
