import { test, expect } from '@playwright/test';
import {
  wp, attachments, deleteAttachments, jpeg, png, bmp, staticGif, animatedGif, svg, webpImage, noisyPng,
} from './fixtures.mjs';

const SETTLE_MS = 90_000;

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async () => {
  await deleteAttachments();
});

/** Feeds files to the uploader's real (hidden) plupload input. */
async function upload(page, files) {
  await page.locator('.moxie-shim input[type=file]').last().setInputFiles(files);
}

/** Waits for `expected` attachments and empty uploader queues; returns them sorted by title. */
async function settle(page, expected) {
  await expect.poll(async () => (await attachments()).length, { timeout: SETTLE_MS }).toBe(expected);
  await page.waitForFunction(() => {
    const queue = window.wp && window.wp.Uploader && window.wp.Uploader.queue;
    const standalone = window.uploader && window.uploader.total;
    return !(queue && queue.length) && !(standalone && standalone.queued);
  }, null, { timeout: SETTLE_MS });
  const list = await attachments();
  return list.sort((a, b) => a.post_title.localeCompare(b.post_title));
}

const summary = (list) => list.map((a) => `${a.post_title}:${a.post_mime_type}`);
// wp-cli exits non-zero for a missing key; treat that as empty.
const meta = (id, key) => wp('post', 'meta', 'get', String(id), key).then((v) => v.trim(), () => '');

async function expectNoStuckTiles(page) {
  const uploading = await page.evaluate(() => window.wp.Uploader.queue.where({ uploading: true }).length);
  expect(uploading).toBe(0);
  await expect(page.locator('.attachment.uploading')).toHaveCount(0);
}

test('add new: jpg+png+bmp+static gif → 4 image/webp attachments, 0 originals', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await upload(page, [await jpeg(page, 640, 480), await png(page, 400, 300), bmp(64, 48), staticGif()]);
  const list = await settle(page, 4);
  expect(summary(list)).toEqual(['bitmap:image/webp', 'graphic:image/webp', 'photo:image/webp', 'still:image/webp']);
});

test('add new: svg, animated gif, webp upload unchanged', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  // SVG is not an allowed upload type: plupload drops it before our hook; it must not turn into a WebP.
  await upload(page, [svg(), animatedGif(), await webpImage(page, 200, 150)]);
  const list = await settle(page, 2);
  expect(summary(list)).toEqual(['already:image/webp', 'moving:image/gif']);
});

test('library grid converts (uploader built at DOM-ready)', async ({ page }) => {
  await page.goto('/wp-admin/upload.php');
  await upload(page, [await jpeg(page, 640, 480)]);
  expect(summary(await settle(page, 1))).toEqual(['photo:image/webp']);
});

test('media modal opened later converts', async ({ page }) => {
  await page.goto('/wp-admin/post-new.php');
  const shims = await page.locator('.moxie-shim input[type=file]').count();
  await page.evaluate(() => window.wp.media({ multiple: true }).open());
  await expect(page.locator('.moxie-shim input[type=file]')).toHaveCount(shims + 1);
  await upload(page, [await png(page, 400, 300)]);
  expect(summary(await settle(page, 1))).toEqual(['graphic:image/webp']);
});

test('overlapping batches: second batch mid-encode → each file once, 0 image/jpeg', async ({ page }) => {
  await page.goto('/wp-admin/upload.php');
  const first = [await jpeg(page, 2400, 1800, 'a.jpg'), await jpeg(page, 2400, 1800, 'b.jpg'), await jpeg(page, 2400, 1800, 'c.jpg')];
  const second = [await jpeg(page, 640, 480, 'd.jpg'), await jpeg(page, 640, 480, 'e.jpg')];
  await upload(page, first);
  await upload(page, second);
  const list = await settle(page, 5);
  expect(summary(list)).toEqual(['a', 'b', 'c', 'd', 'e'].map((t) => `${t}:image/webp`));
});

test('no stuck tiles: no queue model with uploading:true after settle', async ({ page }) => {
  await page.goto('/wp-admin/upload.php');
  await upload(page, [await jpeg(page, 640, 480), await png(page, 400, 300), animatedGif()]);
  await settle(page, 3);
  await expectNoStuckTiles(page);
});

test('webp larger than original (8x8 png) → original uploaded', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await upload(page, [noisyPng(8, 8)]);
  const list = await settle(page, 1);
  expect(summary(list)).toEqual(['noise:image/png']);
  expect(await meta(list[0].ID, '_ds_webp_quality')).toBe('');
});

test('encoder fails (route **/webp_enc*.wasm aborted) → originals uploaded, no stuck tiles', async ({ page, context }) => {
  await context.route('**/webp_enc*.wasm', (route) => route.abort());
  await page.goto('/wp-admin/upload.php');
  await upload(page, [await jpeg(page, 640, 480), await png(page, 400, 300)]);
  const list = await settle(page, 2);
  expect(summary(list)).toEqual(['graphic:image/png', 'photo:image/jpeg']);
  await expectNoStuckTiles(page);
});

test('keep original → _ds_original_backup set, file present, removed on delete', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dsWebpSettings', JSON.stringify({ keepOriginal: true })));
  await page.goto('/wp-admin/upload.php');
  await upload(page, [await jpeg(page, 640, 480)]);
  const [att] = await settle(page, 1);
  expect(att.post_mime_type).toBe('image/webp');
  await expect.poll(() => meta(att.ID, '_ds_original_backup'), { timeout: 30_000 }).toMatch(/photo\.jpg$/);
  const rel = await meta(att.ID, '_ds_original_backup');
  const exists = () => wp('eval', `echo file_exists(wp_upload_dir()['basedir'] . '/${rel}') ? 'yes' : 'no';`);
  expect(await exists()).toBe('yes');
  await wp('post', 'delete', String(att.ID), '--force');
  expect(await exists()).toBe('no');
});

test('meta: _ds_webp_quality=82 and _ds_orig_size=original bytes', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  const file = await jpeg(page, 640, 480);
  await upload(page, [file]);
  const [att] = await settle(page, 1);
  expect(att.post_mime_type).toBe('image/webp');
  expect(await meta(att.ID, '_ds_webp_quality')).toBe('82');
  expect(await meta(att.ID, '_ds_orig_size')).toBe(String(file.buffer.length));
});

test('preview on: modal confirm uploads the WebP, skip uploads the original', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dsWebpSettings', JSON.stringify({ preview: true })));
  await page.goto('/wp-admin/upload.php');
  await upload(page, [await jpeg(page, 640, 480), await png(page, 400, 300)]);
  const modal = page.locator('.ds-webp-modal');
  await expect(modal).toHaveCount(1); // one at a time
  await expect(modal.locator('[data-role=webp-size]')).toHaveText(/KB/);
  await modal.locator('[data-role=confirm]').click();
  await expect(modal).toHaveCount(1);
  await modal.locator('[data-role=skip]').click();
  // Modal order follows classification order, so check one of each rather than which.
  const types = summary(await settle(page, 2)).map((s) => s.split(':')[1]).sort();
  expect(types[1]).toBe('image/webp');
  expect(['image/jpeg', 'image/png']).toContain(types[0]);
});
