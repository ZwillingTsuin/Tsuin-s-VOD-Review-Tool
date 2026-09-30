import { api } from '../api.js';
import { h, put, fill } from '../ui.js';
import { icon } from '../icons.js';
import { henrikSection, accountsSection, twitchSection, prosSection, privacySection, dataFolderSection } from './settings.js';

const STEPS = ['Welcome', 'Your PC', 'API key', 'Your accounts', 'Twitch', 'Pros', 'Done'];

export async function render(root, parts) {
  let step = Math.max(0, Math.min(STEPS.length - 1, Number(parts[0]) || 0));
  const body = h('div', { class: 'setup-body' });
  const nav = h('ol', { class: 'setup-steps' });
  const foot = h('div', { class: 'setup-foot' });
  put(root, h('div', { class: 'setup' }, h('div', { class: 'page-head' }, h('h1', {}, 'Set up'), h('p', { class: 'muted' }, 'About five minutes. Everything can be changed later in Settings.')), nav, body, foot));

  const go = (i) => { step = Math.max(0, Math.min(STEPS.length - 1, i)); history.replaceState(null, '', `#/setup/${step}`); paint(); };
  async function paint() {
    const s = await api.get('/api/settings');
    const accounts = step === 3 ? await api.get('/api/accounts').catch(() => []) : [];
    fill(nav, STEPS.map((t, i) => h('li', { class: i === step ? 'on' : i < step ? 'done' : '' }, h('span', { class: 'num' }, i < step ? icon('check', 12) : i + 1), t)));
    fill(body);
    const next = (label = 'Next', enabled = true, why = '') => h('button', { class: 'primary', disabled: !enabled, 'data-tip': enabled ? null : why, onclick: () => go(step + 1) }, label, icon('chevRight', 14));
    const back = step > 0 && step < STEPS.length - 1 ? h('button', { class: 'quiet', onclick: () => go(step - 1) }, icon('back', 14), 'Back') : h('span');
    const skip = () => h('button', { class: 'quiet', onclick: () => go(step + 1) }, 'Skip for now');
    if (step === 0) {
      put(body, h('section', { class: 'card set welcome' },
        h('h2', {}, 'What this does'),
        h('p', {}, 'It downloads your ranked VALORANT matches and shows each one round by round on the minimap, with every duel. You can go through a match with your VOD or recording and write notes, watch clutches and retakes from pros\' VODs, and see what you do differently from other players.'),
        h('p', { class: 'muted' }, 'You need a free API key (in two steps). Twitch is optional. Everything runs and stays on your PC: the next step shows exactly what the app does there.')));
      fill(foot, h('span'), next('Start'));
    } else if (step === 1) {
      put(body, privacySection(), dataFolderSection({ setup: true }));
      fill(foot, back, next('Sounds good'));
    } else if (step === 2) {
      const n = next('Next', !!s.henrikKey, 'Save a working key first');
      put(body, henrikSection(s, { onSaved: () => go(3) }));
      fill(foot, back, n);
    } else if (step === 3) {
      const n = next('Next', accounts.length > 0, 'Add an account first');
      put(body, accountsSection({ onChange: (accs) => { n.disabled = !accs.length; } }));
      fill(foot, back, n);
    } else if (step === 4) {
      put(body, twitchSection(s, { setup: true, onChannelSaved: () => go(5) }));
      fill(foot, back, h('div', { class: 'row' }, skip(), next()));
    } else if (step === 5) {
      put(body, prosSection());
      fill(foot, back, h('div', { class: 'row' }, skip(), next()));
    } else {
      api.patch('/api/settings', { setupDone: true }).catch(() => {});
      put(body, h('section', { class: 'card set done-card' }, icon('check', 28), h('h2', {}, 'All set'),
        h('p', {}, 'Your matches are downloading in the background (the line at the top shows how far it is). The first time takes a while, about 2 seconds per match.'),
        h('p', { class: 'muted' }, 'The app runs without a window. Stop it with the power button at the top right; it also stops by itself about 45 minutes after you close its last tab. Start it again with Start.bat.')));
      fill(foot, h('button', { class: 'quiet', onclick: () => go(step - 1) }, icon('back', 14), 'Back'), h('a', { class: 'btn primary', href: '#/matches' }, 'Go to your matches', icon('chevRight', 14)));
    }
  }
  await paint();
}
