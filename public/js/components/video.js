// One interface over the Twitch embed, the YouTube iframe player and a <video> of a local recording.
import { h, fill } from '../ui.js';

const loaded = new Map();
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = src; sc.async = true;
    sc.onload = () => res(); sc.onerror = () => { loaded.delete(src); rej(new Error('The video player could not load (offline or blocked).')); };
    document.head.append(sc);
  });
  loaded.set(src, p);
  return p;
}
const twitchT = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`; };

export function createVideo(kind, el, { ref, startAt = 0, onError } = {}) {
  if (kind === 'twitch') return twitchPlayer(el, ref, startAt, onError);
  if (kind === 'youtube') return youtubePlayer(el, ref, startAt, onError);
  if (kind === 'file') return filePlayer(el, ref, startAt, onError);
  return null;
}

// The Twitch embed reports 0 before playing and a stale time during ads: the last seek stands in until the clock moves.
function twitchPlayer(el, vodId, startAt, onError) {
  const id = `tw-${Math.random().toString(36).slice(2)}`;
  fill(el, h('div', { id, class: 'video-fill' }));
  let player = null, lastSeek = startAt, prevT = null;
  const t0 = startAt;
  loadScript('https://player.twitch.tv/js/embed/v1.js', () => !!(window.Twitch && window.Twitch.Player)).then(() => {
    if (!document.getElementById(id)) return;
    player = new window.Twitch.Player(id, { video: vodId, time: twitchT(startAt), parent: [location.hostname], width: '100%', height: '100%', autoplay: false });
  }).catch((err) => onError && onError(err));
  const api = {
    kind: 'twitch',
    now() {
      try {
        const t = player && player.getCurrentTime();
        if (!Number.isFinite(t) || t <= 0) return lastSeek;
        if (player.isPaused()) return Math.abs(t - t0) < 0.5 ? lastSeek : t;
        const moving = prevT != null && t !== prevT;
        prevT = t;
        if (moving) lastSeek = t;
        return moving ? t : lastSeek;
      } catch { return lastSeek; }
    },
    seek(t) { lastSeek = Math.max(0, t); try { if (player) { player.seek(lastSeek); player.play(); } } catch {} },
    toggle() { try { if (player.isPaused()) player.play(); else player.pause(); } catch {} },
    pause() { try { player && player.pause(); } catch {} },
    isPaused() { try { return !player || player.isPaused(); } catch { return true; } },
    destroy() { api.pause(); fill(el); },
  };
  return api;
}

function youtubePlayer(el, videoId, startAt, onError) {
  const id = `yt-${Math.random().toString(36).slice(2)}`;
  fill(el, h('div', { id, class: 'video-fill' }));
  let player = null, ready = false, lastSeek = startAt;
  const ok = () => !!(window.YT && window.YT.Player);
  const waitApi = new Promise((res) => {
    if (ok()) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
  });
  loadScript('https://www.youtube.com/iframe_api', ok).then(() => waitApi).then(() => {
    if (!document.getElementById(id)) return;
    player = new window.YT.Player(id, { videoId, width: '100%', height: '100%', playerVars: { start: Math.floor(startAt), rel: 0, modestbranding: 1 },
      events: { onReady: () => { ready = true; }, onError: () => onError && onError(new Error('YouTube could not play this video (private, removed or not embeddable).')) } });
  }).catch((err) => onError && onError(err));
  const api = {
    kind: 'youtube',
    now() { try { return ready ? player.getCurrentTime() : lastSeek; } catch { return lastSeek; } },
    seek(t) { lastSeek = Math.max(0, t); try { if (ready) { player.seekTo(lastSeek, true); player.playVideo(); } } catch {} },
    toggle() { try { if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo(); } catch {} },
    pause() { try { ready && player.pauseVideo(); } catch {} },
    isPaused() { try { return !ready || player.getPlayerState() !== 1; } catch { return true; } },
    destroy() { try { player && player.destroy(); } catch {} fill(el); },
  };
  return api;
}

function filePlayer(el, rel, startAt, onError) {
  const v = h('video', { class: 'video-fill', controls: true, preload: 'metadata', src: `/api/recordings/stream?f=${encodeURIComponent(rel)}` });
  v.addEventListener('loadedmetadata', () => { if (startAt) v.currentTime = startAt; }, { once: true });
  v.addEventListener('error', () => onError && onError(new Error('This file can\'t be played in the browser. MP4 (H.264) works everywhere; MKV often doesn\'t: remux it to MP4 in OBS (File → Remux Recordings).')));
  fill(el, v);
  return {
    kind: 'file', el: v,
    now: () => v.currentTime || 0,
    seek(t) { v.currentTime = Math.max(0, t); v.play().catch(() => {}); },
    toggle() { if (v.paused) v.play().catch(() => {}); else v.pause(); },
    pause() { v.pause(); },
    isPaused: () => v.paused,
    duration: () => v.duration,
    destroy() { v.pause(); v.removeAttribute('src'); v.load(); fill(el); },
  };
}
