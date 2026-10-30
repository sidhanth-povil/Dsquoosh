import { test, expect } from '@playwright/test';
import { wp, attachments, deleteAttachments, jpeg, png, animatedGif } from './fixtures.mjs';

const SETTLE_MS = 90_000;

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async () => {
  await deleteAttachments();
});

// wp-cli exits non-zero for a missing key; treat that as empty.
const meta = (id, key) => wp('post', 'meta', 'get', String(id), key).then((v) => v.trim(), () => '');

/** Opens a new post in the block editor with the welcome guide dismissed. */
async function openEditor(page) {
  await page.goto('/wp-admin/post-new.php');
  await page.waitForFunction(() => window.wp?.data?.select('core/editor')?.getCurrentPostId());
  await page.evaluate(() => window.wp.data.dispatch('core/preferences').set('core/edit-post', 'welcomeGuide', false));
  await expect(page.locator('.edit-post-welcome-guide')).toHaveCount(0);
}

/** The editor canvas: the iframe when the editor is iframed, else the page itself. */
async function canvas(page) {
  const handle = await page.locator('iframe[name="editor-canvas"]').elementHandle({ timeout: 30_000 }).catch(() => null);
  return handle ? handle.contentFrame() : page.mainFrame();
}

/**
 * Records the FormData field names of every POST to the media collection, as sent by
 * window.fetch (Playwright does not expose multipart bodies carrying files).
 */
async function recordMediaPosts(page) {
  await page.addInitScript(() => {
    window.__dsMediaPosts = [];
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = decodeURIComponent(String((input && input.url) || input));
      if (init && init.body instanceof FormData && /wp\/v2\/media(\?|&|$)/.test(url)) {
        window.__dsMediaPosts.push([...init.body.keys()]);
      }
      return nativeFetch.apply(this, arguments);
    };
  });
  return { fields: () => page.evaluate(() => window.__dsMediaPosts) };
}

/** Drops files on the canvas as a user would (dragenter/dragover/drop with a DataTransfer). */
async function dropOnCanvas(page, files) {
  const frame = await canvas(page);
  const target = frame.locator('.is-root-container').first();
  await target.waitFor();
  const payload = files.map((f) => ({ name: f.name, type: f.mimeType, bytes: Array.from(f.buffer) }));
  await target.evaluate((el, list) => {
    const dt = new DataTransfer();
    list.forEach((f) => dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type })));
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + 10 };
    ['dragenter', 'dragover', 'drop'].forEach((type) => el.dispatchEvent(new DragEvent(type, at)));
  }, payload);
}

/** Inserts an empty Image block and feeds files to its placeholder's real file input. */
async function uploadViaPlaceholder(page, files) {
  await page.evaluate(() => window.wp.data.dispatch('core/block-editor')
    .insertBlocks(window.wp.blocks.createBlock('core/image')));
  const frame = await canvas(page);
  await frame.locator('.wp-block-image input[type=file]').first().setInputFiles(files);
}

/** Waits for one attachment and the image block's final (non-blob) img; returns both. */
async function settle(page) {
  await expect.poll(async () => (await attachments()).length, { timeout: SETTLE_MS }).toBe(1);
  const frame = await canvas(page);
  const img = frame.locator('.wp-block-image img:not([src^="blob:"])');
  await expect(img).toHaveCount(1, { timeout: SETTLE_MS });
  const [att] = await attachments();
  return { att, src: await img.getAttribute('src') };
}

/** Field names of the single media POST the editor sent. */
async function sentFields(posts) {
  const all = await posts.fields();
  expect(all).toHaveLength(1);
  return all[0];
}

test('jpg dropped on canvas → img src ends .webp; attachment image/webp with meta', async ({ page }) => {
  const posts = await recordMediaPosts(page);
  await openEditor(page);
  const file = await jpeg(page, 640, 480);
  await dropOnCanvas(page, [file]);
  const { att, src } = await settle(page);
  expect(src).toMatch(/\.webp$/);
  expect(att.post_mime_type).toBe('image/webp');
  expect(await sentFields(posts)).toContain('_ds_webp_quality');
  expect(await meta(att.ID, '_ds_webp_quality')).toBe('82');
  expect(await meta(att.ID, '_ds_orig_size')).toBe(String(file.buffer.length));
});

test('animated gif dropped → stays image/gif', async ({ page }) => {
  const posts = await recordMediaPosts(page);
  await openEditor(page);
  await dropOnCanvas(page, [animatedGif()]);
  const { att, src } = await settle(page);
  expect(src).toMatch(/\.gif$/);
  expect(att.post_mime_type).toBe('image/gif');
  expect(await sentFields(posts)).not.toContain('_ds_webp_quality');
  expect(await meta(att.ID, '_ds_webp_quality')).toBe('');
});

test('png via Image block placeholder Upload → webp', async ({ page }) => {
  const posts = await recordMediaPosts(page);
  await openEditor(page);
  await uploadViaPlaceholder(page, [await png(page, 400, 300)]);
  const { att, src } = await settle(page);
  expect(src).toMatch(/\.webp$/);
  expect(att.post_mime_type).toBe('image/webp');
  expect(await sentFields(posts)).toContain('_ds_webp_quality');
  expect(await meta(att.ID, '_ds_webp_quality')).toBe('82');
});

test('preview skip in block editor → original uploaded, block not stuck', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dsWebpSettings', JSON.stringify({ preview: true })));
  const posts = await recordMediaPosts(page);
  await openEditor(page);
  await uploadViaPlaceholder(page, [await jpeg(page, 640, 480)]);
  const modal = page.locator('.ds-webp-modal');
  await expect(modal.locator('[data-role=webp-size]')).toHaveText(/KB/, { timeout: SETTLE_MS });
  await modal.getByRole('button', { name: 'Upload original' }).click();
  const { att, src } = await settle(page);
  expect(src).toMatch(/\.jpg$/);
  expect(att.post_mime_type).toBe('image/jpeg');
  expect(await sentFields(posts)).not.toContain('_ds_webp_quality');
  const frame = await canvas(page);
  await expect(frame.locator('.wp-block-image .components-spinner, .wp-block-image.is-transient')).toHaveCount(0);
});

test('keep original works on REST path', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dsWebpSettings', JSON.stringify({ keepOriginal: true })));
  await openEditor(page);
  await uploadViaPlaceholder(page, [await jpeg(page, 640, 480)]);
  const { att } = await settle(page);
  expect(att.post_mime_type).toBe('image/webp');
  await expect.poll(() => meta(att.ID, '_ds_original_backup'), { timeout: 30_000 }).toMatch(/photo\.jpg$/);
  const rel = await meta(att.ID, '_ds_original_backup');
  expect(await wp('eval', `echo file_exists(wp_upload_dir()['basedir'] . '/${rel}') ? 'yes' : 'no';`)).toBe('yes');
});

test('window.__clientSideMediaProcessing === false in editor', async ({ page }) => {
  await openEditor(page);
  expect(await page.evaluate(() => window.__clientSideMediaProcessing)).toBe(false);
});
