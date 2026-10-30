import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { ANIMATED_GIF } from '../tests/gif-bytes.mjs';

const run = promisify(execFile);
export const DEV_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'http://localhost:8089';
export const AUTH_FILE = join(DEV_DIR, '.auth', 'admin.json');

/** Run wp-cli in the cli container; resolves stdout, rejects on non-zero exit. */
export async function wp(...args) {
  const { stdout } = await run('docker', [
    'compose', '-p', 'dswebp', '-f', join(DEV_DIR, 'docker-compose.yml'),
    'exec', '-T', 'cli', 'wp', ...args,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** Log in as admin via the wp-login.php form on the given page. */
export async function login(page) {
  await page.goto(`${BASE_URL}/wp-login.php`);
  await page.fill('#user_login', 'admin');
  await page.fill('#user_pass', 'admin');
  await Promise.all([page.waitForURL('**/wp-admin/**', { timeout: 90_000 }), page.click('#wp-submit')]);
}

/* ---- Upload fixtures: { name, mimeType, buffer } for setInputFiles ---- */

const asUpload = (name, mimeType, bytes) => ({ name, mimeType, buffer: Buffer.from(bytes) });

// Encodes a gradient + noise canvas in the page (realistic, compressible pixels).
async function canvasImage(page, type, w, h, name) {
  const bytes = await page.evaluate(async ({ type, w, h }) => {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#2b6cb0');
    g.addColorStop(1, '#f6ad55');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 50; i++) {
      ctx.fillStyle = `rgba(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255},0.5)`;
      ctx.fillRect((i * 7919) % w, (i * 104729) % h, 3, 3);
    }
    const blob = await c.convertToBlob({ type, quality: 0.92 });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { type, w, h });
  return asUpload(name, type, bytes);
}

export const jpeg = (page, w, h, name = 'photo.jpg') => canvasImage(page, 'image/jpeg', w, h, name);
export const png = (page, w, h, name = 'graphic.png') => canvasImage(page, 'image/png', w, h, name);
export const webpImage = (page, w, h, name = 'already.webp') => canvasImage(page, 'image/webp', w, h, name);

/** 24-bit bottom-up BMP with a gradient, built in Node. */
export function bmp(w, h, name = 'bitmap.bmp') {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + rowSize * h);
  buf.write('BM', 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = 54 + y * rowSize + x * 3;
      buf[o] = (x * 255) / w; buf[o + 1] = (y * 255) / h; buf[o + 2] = 128;
    }
  }
  return asUpload(name, 'image/bmp', buf);
}

// Uncompressed-LZW GIF (8-bit codes, clear every 254 pixels so width stays 9 bits).
function lzwUncompressed(pixels) {
  const CLEAR = 256, END = 257, RUN = 254;
  const codes = [];
  pixels.forEach((p, i) => { if (i % RUN === 0) codes.push(CLEAR); codes.push(p); });
  codes.push(END);
  const out = [];
  let acc = 0, bits = 0;
  for (const code of codes) {
    acc |= code << bits; bits += 9;
    while (bits >= 8) { out.push(acc & 0xff); acc >>>= 8; bits -= 8; }
  }
  if (bits) out.push(acc);
  const blocks = [];
  for (let i = 0; i < out.length; i += 255) blocks.push(Math.min(255, out.length - i), ...out.slice(i, i + 255));
  return [8, ...blocks, 0];
}

/** Single-frame 256-grey gradient GIF large enough that WebP wins on size. */
export function staticGif(w = 64, h = 64, name = 'still.gif') {
  const le = (n) => [n & 0xff, n >> 8];
  const palette = Array.from({ length: 256 }, (_, i) => [i, i, i]).flat();
  const pixels = Array.from({ length: w * h }, (_, i) => Math.floor(((i % w) * 255) / w));
  const bytes = [
    ...Buffer.from('GIF89a'), ...le(w), ...le(h), 0xf7, 0, 0, ...palette,
    0x2c, 0, 0, 0, 0, ...le(w), ...le(h), 0, ...lzwUncompressed(pixels), 0x3b,
  ];
  return asUpload(name, 'image/gif', bytes);
}

export const animatedGif = (name = 'moving.gif') => asUpload(name, 'image/gif', ANIMATED_GIF);

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + body.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** 1-bit noise PNG: deflate beats lossy WebP here, so the WebP comes out larger. */
export function noisyPng(w = 8, h = 8, name = 'noise.png') {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 1; // bit depth 1, colour type 0 (greyscale)
  const rowBytes = Math.ceil(w / 8);
  const raw = Buffer.alloc((rowBytes + 1) * h);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) {
    if (i % (rowBytes + 1) === 0) continue; // filter byte 0
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = seed >> 16;
  }
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
  return asUpload(name, 'image/png', bytes);
}

export const svg = (name = 'icon.svg') => asUpload(name, 'image/svg+xml',
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'));

/** Attachments as [{ ID, post_title, post_mime_type }]. */
export async function attachments() {
  return JSON.parse(await wp('post', 'list', '--post_type=attachment', '--post_status=any',
    '--fields=ID,post_title,post_mime_type', '--format=json'));
}

export async function deleteAttachments() {
  const ids = (await attachments()).map((a) => String(a.ID));
  if (ids.length) await wp('post', 'delete', ...ids, '--force');
}
