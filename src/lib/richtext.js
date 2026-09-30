// Notes are stored as HTML reduced to an allowlist; the page filters again before showing them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_DIR, writeFileAtomic } from './paths.js';

const TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote', 'code', 'a', 'img', 'span']);
const VOID = new Set(['br', 'img']);
export const IMAGE_NAME = /^[a-f0-9]{24}\.(png|jpg|webp|gif)$/;

// notes from before the editor are plain text
export const isHtml = (s) => /<(p|div|br|b|strong|i|em|u|s|ul|ol|li|h3|h4|blockquote|code|a|img|span)\b/i.test(String(s || ''));

const escapeText = (s) => s.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function cleanAttrs(tag, raw) {
  const attrs = {};
  const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = (m[3] ?? m[4] ?? m[5] ?? '').replace(/&amp;/g, '&');
  if (tag === 'a') {
    const href = attrs.href || '';
    return /^https?:\/\/[^\s"<>]+$/i.test(href) ? ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"` : '';
  }
  if (tag === 'img') {
    const src = attrs.src || '';
    const name = src.startsWith('/api/images/') ? src.slice(12) : '';
    if (!IMAGE_NAME.test(name)) return null;   // only screenshots stored by the app
    const size = ['min', 's', 'm', 'l', 'full'].includes(attrs['data-size']) ? ` data-size="${attrs['data-size']}"` : '';
    return ` src="/api/images/${name}" alt="${escapeAttr((attrs.alt || 'screenshot').slice(0, 100))}"${size}`;
  }
  return '';
}

export function sanitizeHtml(html) {
  const s = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  let out = '', last = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(s))) {
    out += escapeText(s.slice(last, m.index));
    last = re.lastIndex;
    const [, close, name] = m, tag = name.toLowerCase();
    if (!TAGS.has(tag)) continue;
    if (close) { if (!VOID.has(tag)) out += `</${tag}>`; continue; }
    const attrs = cleanAttrs(tag, m[3]);
    if (attrs === null) continue;
    out += `<${tag}${attrs}>`;
  }
  out += escapeText(s.slice(last));
  return out.trim();
}

export function plainText(body) {
  const s = String(body || '');
  if (!isHtml(s)) return s;
  return s.replace(/<(br|\/p|\/div|\/li|\/h3|\/h4)\b[^>]*>/gi, '\n').replace(/<img\b[^>]*>/gi, ' [screenshot] ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

// by the file's magic bytes, not what the browser claims
function typeOf(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

// named by content hash: the same screenshot pasted twice is one file
export function saveImage(buf) {
  const type = typeOf(buf);
  if (!type) return null;
  const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24)}.${type}`;
  const file = path.join(IMAGE_DIR, name);
  if (!fs.existsSync(file)) { fs.mkdirSync(IMAGE_DIR, { recursive: true }); writeFileAtomic(file, buf); }
  return name;
}
export const imagePath = (name) => (IMAGE_NAME.test(name) ? path.join(IMAGE_DIR, name) : null);
export const imagesIn = (bodies) => [...new Set(bodies.flatMap((b) => [...String(b || '').matchAll(/\/api\/images\/([a-f0-9]{24}\.(?:png|jpg|webp|gif))/g)].map((m) => m[1])))];
