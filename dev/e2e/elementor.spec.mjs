import { test, expect } from '@playwright/test';
import { wp, attachments, deleteAttachments, jpeg } from './fixtures.mjs';

const SETTLE_MS = 90_000;
let installed = false;
let pageId = '';

test.describe.configure({ timeout: 200_000 });

// Installs Elementor on demand; the whole file skips when that fails (e.g. no network).
test.beforeAll(async () => {
  test.setTimeout(240_000);
  try {
    await wp('plugin', 'is-active', 'elementor').catch(() => wp('plugin', 'install', 'elementor', '--activate'));
    installed = true;
    await deleteAttachments();
    pageId = (await wp('post', 'create', '--post_type=page', '--post_status=publish', '--post_title=DS Elementor', '--porcelain')).trim();
  } catch (e) {
    installed = false;
  }
});

// Leave the stack as other specs expect it: Elementor off.
test.afterAll(async () => {
  if (pageId) await wp('post', 'delete', pageId, '--force').catch(() => {});
  if (installed) await wp('plugin', 'deactivate', 'elementor').catch(() => {});
});

test('Elementor media modal upload → WebP attachment, panel inside the editor', async ({ page }) => {
  test.skip(!installed, 'Elementor could not be installed (no network?)');
  await page.goto(`/wp-admin/post.php?post=${pageId}&action=elementor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.elementor?.documents?.getCurrent?.() && window.$e, null, { timeout: 120_000 });

  // Task 5 hooks (elementor/editor/wp_head, after_enqueue_scripts) must print config + disable client-side processing.
  const flags = await page.evaluate(() => ({ cfg: typeof window.DSWebPConfig, csm: window.__clientSideMediaProcessing }));
  expect(flags).toEqual({ cfg: 'object', csm: false });

  const preview = page.locator('.elementor-control-image .elementor-control-media__preview').first();
  // A cold editor reports its preview container before it accepts new elements: retry until the Image controls appear.
  await expect.poll(async () => {
    if (await preview.count()) return true;
    await page.evaluate(() => {
      const { $e: api, elementor: el } = window;
      const container = el.getPreviewContainer?.();
      if (!container) return;
      const box = api.run('document/elements/create', { container, model: { elType: 'container' } });
      api.run('document/elements/create', { container: box, model: { elType: 'widget', widgetType: 'image' }, options: { edit: true } });
    });
    await page.waitForTimeout(3000); // inherent: give Elementor time to open the widget panel
    return (await preview.count()) > 0;
  }, { timeout: 120_000, intervals: [1000] }).toBe(true);
  // The empty preview has no box of its own; Elementor listens for a click on it.
  await preview.dispatchEvent('click');
  const modal = page.locator('.media-modal');
  await expect(modal).toBeVisible();
  await modal.locator('.moxie-shim input[type=file]').last().setInputFiles(await jpeg(page, 1200, 900, 'hero.jpg'));

  await expect(page.locator('section.ds-webp-panel')).toBeVisible();
  await expect.poll(async () => (await attachments()).map((a) => a.post_mime_type), { timeout: SETTLE_MS }).toEqual(['image/webp']);
  await expect(page.locator('section.ds-webp-panel .ds-webp-panel__row[data-status=done]')).toHaveCount(1, { timeout: SETTLE_MS });
});
