import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, wp } from '../e2e/fixtures.mjs';
import { STATIC_GIF } from './gif-bytes.mjs';

const up = await fetch(`${BASE_URL}/wp-login.php`).then((r) => r.ok, () => false);
const opts = up ? {} : { skip: `${BASE_URL} is down (run bash dev/setup.sh)` };

// 1x1 lossless WebP.
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const BMP = (() => {
  const b = Buffer.alloc(58);
  b.write('BM', 0); b.writeUInt32LE(58, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(1, 18); b.writeInt32LE(1, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  return b;
})();

let appPass = '';
let cookie = '';
let attachmentIds = [];

const basic = () => ({ Authorization: 'Basic ' + Buffer.from(`admin:${appPass}`).toString('base64') });

async function login() {
  const res = await fetch(`${BASE_URL}/wp-login.php`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'wordpress_test_cookie=WP%20Cookie%20check' },
    body: new URLSearchParams({ log: 'admin', pwd: 'admin', 'wp-submit': 'Log In' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const adminHtml = (path) => fetch(`${BASE_URL}/wp-admin/${path}`, { headers: { cookie } }).then((r) => r.text());

async function restUpload(fields) {
  const form = new FormData();
  form.set('file', new Blob([WEBP], { type: 'image/webp' }), `t${Date.now()}${Math.random().toString(36).slice(2, 6)}.webp`);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(`${BASE_URL}/?rest_route=/wp/v2/media`, { method: 'POST', headers: basic(), body: form });
  assert.equal(res.status, 201, (await res.clone().text()).slice(0, 300));
  const { id } = await res.json();
  attachmentIds.push(id);
  return id;
}

const meta = async (id, key) => (await wp('post', 'meta', 'get', String(id), key).catch(() => '')).trim();

before(async () => {
  if (!up) return;
  appPass = (await wp('user', 'application-password', 'create', 'admin', 'dswebp-test', '--porcelain')).trim();
  cookie = await login();
}, { timeout: 60_000 });

after(async () => {
  if (!up) return;
  await wp('option', 'delete', 'ds_dev_no_webp').catch(() => {});
  await wp('user', 'application-password', 'delete', 'admin', '--all').catch(() => {});
  if (attachmentIds.length) await wp('post', 'delete', ...attachmentIds.map(String), '--force').catch(() => {});
});

test('REST upload with _ds fields stores meta', opts, async () => {
  const id = await restUpload({ _ds_webp_quality: '70', _ds_orig_size: '1234' });
  assert.equal(await meta(id, '_ds_webp_quality'), '70');
  assert.equal(await meta(id, '_ds_orig_size'), '1234');
});

test('REST upload clamps quality to 1-100', opts, async () => {
  const id = await restUpload({ _ds_webp_quality: '999', _ds_orig_size: '5' });
  assert.equal(await meta(id, '_ds_webp_quality'), '100');
});

test('REST upload without fields stores no _ds meta', opts, async () => {
  const id = await restUpload({});
  assert.equal(await meta(id, '_ds_webp_quality'), '');
  assert.equal(await meta(id, '_ds_orig_size'), '');
});

const readConfig = (html) => JSON.parse(html.match(/window\.DSWebPConfig = (\{.*?\});/)[1]);

test('config webpSupported true; false after wp option update ds_dev_no_webp 1', opts, async () => {
  await wp('option', 'delete', 'ds_dev_no_webp').catch(() => {});
  assert.equal(readConfig(await adminHtml('upload.php')).webpSupported, true);
  await wp('option', 'update', 'ds_dev_no_webp', '1');
  try {
    assert.equal(readConfig(await adminHtml('upload.php')).webpSupported, false);
  } finally {
    await wp('option', 'delete', 'ds_dev_no_webp');
  }
});

test('post-new.php prints __clientSideMediaProcessing = false before wp-block-editor script', opts, async () => {
  const html = await adminHtml('post-new.php');
  const flag = html.indexOf('window.__clientSideMediaProcessing = false;');
  const cfg = html.indexOf('window.DSWebPConfig');
  const editor = html.search(/<script[^>]+src=[^>]*block-editor[^>]*>/);
  assert.ok(flag > -1 && cfg > -1 && editor > -1, 'flag, config and block-editor script present');
  assert.ok(flag < editor && cfg < editor);
  assert.ok(html.indexOf('</head>') > cfg, 'config printed inside <head>');
  assert.equal(html.split('window.DSWebPConfig =').length, 2, 'printed once');
});

test('studio.js is served with Cache-Control: no-cache and wasm as application/wasm', opts, async () => {
  const res = await fetch(`${BASE_URL}/wp-content/mu-plugins/ds-webp-squoosh/assets/studio.js`);
  assert.match(res.headers.get('cache-control') ?? '', /no-cache/);
});

async function vault(name, bytes, type) {
  const nonce = readConfig(await adminHtml('upload.php')).nonce;
  const id = await restUpload({});
  const form = new FormData();
  form.set('action', 'ds_save_original_backup');
  form.set('nonce', nonce);
  form.set('attachment_id', String(id));
  form.set('original_file', new Blob([bytes], { type }), name);
  const res = await fetch(`${BASE_URL}/wp-admin/admin-ajax.php`, { method: 'POST', headers: { cookie }, body: form });
  return res.status;
}

test('vault accepts gif and bmp; rejects text renamed .jpg', opts, async () => {
  assert.equal(await vault('a.gif', STATIC_GIF, 'image/gif'), 200);
  assert.equal(await vault('a.bmp', BMP, 'image/bmp'), 200);
  assert.equal(await vault('a.jpg', Buffer.from('not an image'), 'image/jpeg'), 415);
});
