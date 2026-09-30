// #/setup  #/matches  #/match/<id>/<puuid>[/r<round>]  #/review/<id>  #/pros  #/play/<id>  #/reviews  #/insights  #/settings
import { api, loadPrefs } from './api.js';
import { h, installTooltips, toast, fill, ask } from './ui.js';
import { icon } from './icons.js';
import { loadAssets } from './assets.js';
import { watchSelects } from './components/dropdown.js';

const PAGES = {
  setup: () => import('./pages/setup.js'),
  matches: () => import('./pages/matches.js'),
  match: () => import('./pages/match.js'),
  review: () => import('./pages/review.js'),
  pros: () => import('./pages/pros.js'),
  play: () => import('./pages/review.js'),
  reviews: () => import('./pages/reviews.js'),
  insights: () => import('./pages/insights.js'),
  settings: () => import('./pages/settings.js'),
};
const view = document.getElementById('view');
let cleanup = null, token = 0;
export let status = null;

async function route() {
  const my = ++token;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  let page = parts[0] || '';
  if (!status) status = await api.get('/api/status').catch(() => null);
  if (!page) page = status && (!status.setup.henrik || !status.setup.accounts) && !status.setup.done ? 'setup' : 'matches';
  if (!PAGES[page]) page = 'matches';
  document.body.classList.toggle('in-setup', page === 'setup');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === page || (page === 'match' && a.dataset.nav === 'matches') || (page === 'play' && a.dataset.nav === 'pros') || (page === 'review' && a.dataset.nav === 'reviews')));
  if (typeof cleanup === 'function') { try { cleanup(); } catch {} }
  cleanup = null;
  const mod = await PAGES[page]();
  if (my !== token) return;
  fill(view);
  view.className = `page-${page}`;
  window.scrollTo(0, 0);
  try {
    const fn = page === 'play' ? mod.renderPlay : mod.render;
    cleanup = await fn(view, parts.slice(1), { status });
  } catch (err) {
    console.error(err);
    if (my === token) fill(view, h('div', { class: 'empty' }, icon('warn', 22), h('h3', {}, 'This page could not load'), h('p', { class: 'muted' }, err.message)));
  }
}

let stopped = false, misses = 0;
const banner = h('div', { class: 'app-banner', role: 'status', hidden: true });
function showBanner(...kids) { fill(banner, ...kids); banner.hidden = !kids.length; }
async function pollStatus() {
  if (stopped) return;
  try {
    status = await api.get('/api/status');
    if (misses >= 2) location.reload();
    misses = 0;
    const el = document.getElementById('sync');
    const b = status.backfill, q = status.henrik.queue;
    let text = '', warn = false;
    if (!status.setup.henrik) { text = 'No API key yet'; warn = true; }
    else if (status.henrik.ok === false && status.henrik.error) { text = status.henrik.error; warn = true; }
    else if (b.running && b.total) text = `Downloading match data ${b.done}/${b.total}`;
    else if (status.pros.running) text = 'Updating pro matches…';
    else if (status.vod.running) text = 'Checking Twitch VODs…';
    else if (q.user + q.sync > 0) text = 'Updating…';
    fill(el, text ? h('span', { class: warn ? 'warn' : 'busy' }, warn ? icon('warn', 13) : h('i', { class: 'spinner' }), text) : '');
    if (warn && !status.setup.henrik) el.firstChild.onclick = () => { location.hash = '#/settings'; };
    if (status.updated) showBanner(icon('info', 15), h('span', {}, `Version ${status.updated} is installed. Stop the app (power button) and start it again with Start.bat to use it.`));
    else showBanner();
  } catch {
    // twice in a row: the server is gone
    if (++misses === 2) showBanner(icon('power', 15), h('span', {}, h('b', {}, 'The app is not running anymore. '),
      `It stops by itself about ${status && status.idleStopMin ? status.idleStopMin : 45} minutes after its last tab was closed, or with the power button. Start it again with Start.bat; this page reloads by itself.`));
  }
  setTimeout(pollStatus, misses ? 5000 : status && (status.backfill.running || status.pros.running) ? 4000 : 15000);
}

async function start() {
  installTooltips();
  watchSelects(view);
  document.querySelector('.nav-gear').append(icon('gear', 18));
  document.body.prepend(banner);
  const quit = document.querySelector('.nav-quit');
  quit.append(icon('power', 17));
  quit.onclick = async () => {
    if (!(await ask('Stop the app? Downloads pause until you start it again with Start.bat.', { ok: 'Stop the app' }))) return;
    showBanner();
    stopped = true;
    await api.post('/api/quit').catch(() => {});
    document.body.classList.add('in-setup');
    fill(view, h('div', { class: 'empty' }, icon('power', 26), h('h3', {}, 'The app is stopped'), h('p', { class: 'muted' }, 'You can close this tab. To use it again, run Start.bat.')));
  };
  await Promise.all([loadAssets(), loadPrefs()]);
  window.addEventListener('hashchange', route);
  window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.message) toast(e.reason.message, 'bad'); });
  await route();
  pollStatus();
}
start();
