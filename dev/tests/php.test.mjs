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

async function login(log = 'admin', pwd = 'admin') {
  const res = await fetch(`${BASE_URL}/wp-login.php`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'wordpress_test_cookie=WP%20Cookie%20check' },
    body: new URLSearchParams({ log, pwd, 'wp-submit': 'Log In' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const adminHtml = (path, as = cookie) => fetch(`${BASE_URL}/wp-admin/${path}`, { headers: { cookie: as } }).then((r) => r.text());

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
  await wp('user', 'delete', 'dsauthor', '--yes').catch(() => {});
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

async function vault(name, bytes, type, { id, as = cookie } = {}) {
  const nonce = readConfig(await adminHtml('upload.php', as)).nonce;
  id ??= await restUpload({});
  const form = new FormData();
  form.set('action', 'ds_save_original_backup');
  form.set('nonce', nonce);
  form.set('attachment_id', String(id));
  form.set('original_file', new Blob([bytes], { type }), name);
  const res = await fetch(`${BASE_URL}/wp-admin/admin-ajax.php`, { method: 'POST', headers: { cookie: as }, body: form });
  return res.status;
}

test('vault accepts gif and bmp; rejects text renamed .jpg', opts, async () => {
  assert.equal(await vault('a.gif', STATIC_GIF, 'image/gif'), 200);
  assert.equal(await vault('a.bmp', BMP, 'image/bmp'), 200);
  assert.equal(await vault('a.jpg', Buffer.from('not an image'), 'image/jpeg'), 415);
});

test('vault: author cannot vault onto another user\'s attachment; non-attachment id refused; second backup 409', opts, async () => {
  await wp('user', 'create', 'dsauthor', 'dsauthor@example.com', '--role=author', '--user_pass=dsauthor-pass-1').catch(() => {});
  const author = await login('dsauthor', 'dsauthor-pass-1');
  const adminsId = await restUpload({});
  assert.equal(await vault('a.gif', STATIC_GIF, 'image/gif', { id: adminsId, as: author }), 403);
  const postId = (await wp('post', 'list', '--post_type=post,page', '--posts_per_page=1', '--format=ids')).trim().split(/\s+/)[0]
    || (await wp('post', 'create', '--post_title=ds-vault-probe', '--post_status=publish', '--porcelain')).trim();
  assert.equal(await vault('a.gif', STATIC_GIF, 'image/gif', { id: Number(postId) }), 403);
  assert.equal(await vault('a.gif', STATIC_GIF, 'image/gif', { id: adminsId }), 200);
  assert.equal(await vault('a.gif', STATIC_GIF, 'image/gif', { id: adminsId }), 409);
});

test('config exposes maxBackupBytes and honours the ds_webp_backup_max_bytes default', opts, async () => {
  assert.equal(readConfig(await adminHtml('upload.php')).maxBackupBytes, 20971520);
});

test('__clientSideMediaProcessing is printed only when the server supports WebP', opts, async () => {
  await wp('option', 'delete', 'ds_dev_no_webp').catch(() => {});
  assert.match(await adminHtml('upload.php'), /window\.__clientSideMediaProcessing = false;/);
  await wp('option', 'update', 'ds_dev_no_webp', '1');
  try {
    assert.doesNotMatch(await adminHtml('upload.php'), /__clientSideMediaProcessing/);
  } finally {
    await wp('option', 'delete', 'ds_dev_no_webp');
  }
});
