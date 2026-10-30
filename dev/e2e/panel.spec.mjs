import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { wp, attachments, deleteAttachments, jpeg, animatedGif, noisyPng, DEV_DIR } from './fixtures.mjs';

const SETTLE_MS = 90_000;
const AUTO_HIDE_MS = 4000;
const SCREENS = join(DEV_DIR, 'e2e', '__screens__');

test.describe.configure({ timeout: 180_000 });

// Each test gets a fresh browser context, so settings start from defaults.
test.beforeEach(async () => {
  await deleteAttachments();
});

const panel = (page) => page.locator('section.ds-webp-panel');
const badge = (page) => panel(page).locator('.ds-webp-panel__badge');
const settingsBox = (page) => panel(page).locator('.ds-webp-panel__settings');
const rows = (page) => panel(page).locator('.ds-webp-panel__row');
const doneRows = (page) => panel(page).locator('.ds-webp-panel__row[data-status=done]');
const footer = (page) => panel(page).locator('.ds-webp-panel__foot');
const screenshot = (page, name) => {
  mkdirSync(SCREENS, { recursive: true });
  return page.screenshot({ path: join(SCREENS, `${name}.png`), animations: 'disabled' });
};

async function upload(page, files) {
  await page.locator('.moxie-shim input[type=file]').last().setInputFiles(files);
}

async function waitForAttachments(n) {
  await expect.poll(async () => (await attachments()).length, { timeout: SETTLE_MS }).toBe(n);
}

async function openEditor(page) {
  await page.goto('/wp-admin/post-new.php');
  await page.waitForFunction(() => window.wp?.data?.select('core/editor')?.getCurrentPostId());
  await page.evaluate(() => window.wp.data.dispatch('core/preferences').set('core/edit-post', 'welcomeGuide', false));
  await expect(page.locator('.edit-post-welcome-guide')).toHaveCount(0);
}

test('collapsed badge visible on media-new.php, absent on dashboard', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute('aria-label', 'WebP converter');
  await expect(panel(page).locator('.ds-webp-panel__title')).toHaveText('WebP converter');
  await expect(badge(page)).toHaveText(/⚡ 82%/);
  await expect(badge(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsBox(page)).toBeHidden();
  await screenshot(page, 'collapsed');

  await page.goto('/wp-admin/index.php');
  await expect(panel(page)).toBeHidden();
});

test('badge toggles settings and aria-expanded', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await badge(page).click();
  await expect(badge(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(settingsBox(page)).toBeVisible();
  await expect(panel(page).getByRole('switch', { name: 'Convert uploads to WebP' })).toHaveAttribute('aria-checked', 'true');
  await expect(panel(page).getByRole('radio', { name: 'Balanced' })).toBeChecked();
  await expect(panel(page).getByLabel('Keep original copy')).not.toBeChecked();
  await expect(panel(page).getByLabel('Preview each image before upload')).not.toBeChecked();
  await screenshot(page, 'expanded');
  await badge(page).click();
  await expect(badge(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsBox(page)).toBeHidden();
});

test('Smallest preset → quality 60, slider label 60%', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await badge(page).click();
  await panel(page).getByText('Smallest', { exact: true }).click();
  await expect(panel(page).getByRole('radio', { name: 'Smallest' })).toBeChecked();
  await expect(panel(page).getByRole('slider')).toHaveValue('60');
  await expect(panel(page).locator('.ds-webp-panel__qvalue')).toHaveText('60%');
  await expect(badge(page)).toHaveText(/⚡ 60%/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsWebpSettings')).quality);
  expect(saved).toBe(60);
});

test('slider 70 → no preset checked, badge ⚡ 70%', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await badge(page).click();
  await panel(page).getByRole('slider').fill('70');
  await expect(panel(page).locator('.ds-webp-panel__qvalue')).toHaveText('70%');
  await expect(badge(page)).toHaveText(/⚡ 70%/);
  for (const name of ['Smallest', 'Balanced', 'Sharp']) {
    await expect(panel(page).getByRole('radio', { name })).not.toBeChecked();
  }
});

test('upload 2 jpgs → two rows with savings, footer "✓ 2 of 2 converted"', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await upload(page, [await jpeg(page, 1600, 1200, 'one.jpg'), await jpeg(page, 640, 480, 'two.jpg')]);
  await expect(rows(page)).toHaveCount(2);
  await expect(doneRows(page)).toHaveCount(2, { timeout: SETTLE_MS });
  await panel(page).hover(); // hold the list open for the assertions
  for (const name of ['one.jpg', 'two.jpg']) {
    const row = rows(page).filter({ hasText: name });
    await expect(row.locator('.ds-webp-panel__detail')).toHaveText(/^\d+(\.\d)? (KB|MB) → \d+(\.\d)? (KB|MB) · −\d+%$/);
    await expect(row.locator('img')).toHaveAttribute('src', /^blob:/);
  }
  await expect(footer(page)).toHaveText(/^✓ 2 of 2 converted · saved \d+(\.\d)? (KB|MB)$/);
  await expect(panel(page).locator('[aria-live=polite]')).toHaveCount(1);
  await waitForAttachments(2);
});

test('progress screenshot: converted, kept and animated rows', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await panel(page).hover();
  await upload(page, [noisyPng(8, 8), animatedGif('logo.gif'), await jpeg(page, 2400, 1800, 'team-photo.jpg'),
    await jpeg(page, 2400, 1800, 'banner.jpg')]);
  // Best effort mid-flight shot (conversion may already be over on a fast machine).
  await expect(panel(page).locator('.ds-webp-panel__row[data-status=converting]').first())
    .toBeVisible({ timeout: SETTLE_MS }).catch(() => {});
  await screenshot(page, 'progress');
  await expect(doneRows(page)).toHaveCount(4, { timeout: SETTLE_MS });
  await expect(footer(page)).toHaveText(/^✓ 2 of 4 converted · saved/);
  await screenshot(page, 'progress-done');
  await waitForAttachments(4);
});

test('animated gif row reads "Animated — uploaded as is"', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await upload(page, [animatedGif('logo.gif')]);
  const row = rows(page).filter({ hasText: 'logo.gif' });
  await expect(row.locator('.ds-webp-panel__detail')).toHaveText('Animated — uploaded as is', { timeout: SETTLE_MS });
  await waitForAttachments(1);
});

test('auto-hides ~4s after done, stays while hovered', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await panel(page).hover();
  await upload(page, [await jpeg(page, 640, 480)]);
  await expect(doneRows(page)).toHaveCount(1, { timeout: SETTLE_MS });
  await page.waitForTimeout(AUTO_HIDE_MS + 1000); // inherent: proving it does NOT hide while hovered
  await expect(rows(page)).toHaveCount(1);

  await page.mouse.move(5, 5);
  const left = Date.now();
  await expect(rows(page)).toHaveCount(0, { timeout: AUTO_HIDE_MS + 6000 });
  expect(Date.now() - left).toBeGreaterThanOrEqual(AUTO_HIDE_MS - 500);
  await expect(badge(page)).toBeVisible(); // uploader still on screen → collapsed panel stays
  await waitForAttachments(1);
});

test.describe('server without WebP support', () => {
  test.beforeEach(async () => { await wp('option', 'update', 'ds_dev_no_webp', '1'); });
  test.afterEach(async () => { await wp('option', 'delete', 'ds_dev_no_webp'); });

  test('ds_dev_no_webp=1 → banner shown, switch disabled, originals uploaded', async ({ page }) => {
    await page.goto('/wp-admin/media-new.php');
    await expect(page.evaluate(() => window.DSWebPConfig.webpSupported)).resolves.toBe(false);
    await expect(panel(page).locator('.ds-webp-panel__banner')).toHaveText("This server can't process WebP — uploading originals");
    await badge(page).click();
    await expect(panel(page).getByRole('switch', { name: 'Convert uploads to WebP' })).toBeDisabled();
    await upload(page, [await jpeg(page, 640, 480)]);
    await expect(rows(page).locator('.ds-webp-panel__detail')).toHaveText('Uploaded as original', { timeout: SETTLE_MS });
    await waitForAttachments(1);
    expect((await attachments())[0].post_mime_type).toBe('image/jpeg');
  });
});

test('editor toolbar button opens panel expanded', async ({ page }) => {
  await openEditor(page);
  const btn = page.locator('.editor-header__settings .ds-webp-editor-btn, .edit-post-header__settings .ds-webp-editor-btn');
  await expect(btn).toHaveCount(1);
  await expect(btn).toHaveText('⚡ WebP · 82%');
  await expect(btn).toHaveAttribute('type', 'button');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).toBeHidden();
  await btn.click();
  await expect(panel(page)).toBeVisible();
  await expect(settingsBox(page)).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await screenshot(page, 'editor-button');

  await panel(page).getByRole('switch').click();
  await expect(btn).toHaveText('⚡ WebP · off');
  await expect(badge(page)).toHaveText(/⚡ off/);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).toBeHidden();
});

test('editor toolbar button is re-inserted after the header re-renders', async ({ page }) => {
  await openEditor(page);
  const btn = page.locator('.editor-header__settings .ds-webp-editor-btn, .edit-post-header__settings .ds-webp-editor-btn');
  await expect(btn).toHaveCount(1);
  const toggle = (key) => page.evaluate((k) => window.wp.data.dispatch('core/preferences').toggle('core', k), key);
  for (const key of ['distractionFree', 'fixedToolbar']) {
    await toggle(key);
    await page.waitForTimeout(500); // inherent: let React finish swapping the header
    await toggle(key);
    await expect(btn).toHaveCount(1);
    await expect(btn).toBeVisible();
  }
  await btn.evaluate((node) => node.remove()); // worst case: React dropped the node outright
  await expect(btn).toHaveCount(1);
  await expect(btn).toHaveText('⚡ WebP · 82%');
});

test('media modal Library tab: collapsed panel does not cover the attachment sidebar', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await upload(page, [await jpeg(page, 640, 480, 'sidebar.jpg')]);
  await waitForAttachments(1);
  await page.goto('/wp-admin/upload.php');
  await page.waitForFunction(() => window.wp?.media);
  await page.evaluate(() => window.wp.media({ title: 'Test', multiple: false }).open());
  await page.locator('.media-modal').getByRole('tab', { name: 'Media Library' }).click();
  await page.locator('.media-modal .attachment').first().click();
  const sidebar = page.locator('.media-modal .media-sidebar');
  await expect(sidebar.locator('[data-setting=alt] input, [data-setting=alt] textarea').first()).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await expect(settingsBox(page)).toBeHidden();
  await expect(rows(page)).toHaveCount(0);
  await screenshot(page, 'modal-library');
  const [p, s] = await Promise.all([panel(page).boundingBox(), sidebar.boundingBox()]);
  const overlaps = p.x < s.x + s.width && p.x + p.width > s.x && p.y < s.y + s.height && p.y + p.height > s.y;
  expect(overlaps, `panel ${JSON.stringify(p)} vs sidebar ${JSON.stringify(s)}`).toBe(false);
});

test('keyboard: Tab reaches badge, Enter expands, Space toggles switch', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await expect(badge(page)).toBeVisible();
  // The panel is the last thing in <body>: Shift+Tab from the top lands in it.
  let onBadge = false;
  for (let i = 0; i < 10 && !onBadge; i++) {
    await page.keyboard.press('Shift+Tab');
    onBadge = await badge(page).evaluate((el) => el === document.activeElement);
  }
  expect(onBadge).toBe(true);
  await page.keyboard.press('Enter');
  await expect(badge(page)).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Tab');
  const sw = panel(page).getByRole('switch');
  await expect(sw).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(badge(page)).toHaveText(/⚡ off/);
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('radio', { name: 'Balanced' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByRole('slider')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel(page).getByLabel('Keep original copy')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(settingsBox(page)).toBeHidden();
  await expect(badge(page)).toBeFocused();
});

test('settings persist across reload', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  await badge(page).click();
  await panel(page).getByText('Sharp', { exact: true }).click();
  await panel(page).getByLabel('Keep original copy').check();
  await page.reload();
  await expect(badge(page)).toHaveText(/⚡ 92%/);
  await badge(page).click();
  await expect(panel(page).getByRole('radio', { name: 'Sharp' })).toBeChecked();
  await expect(panel(page).getByLabel('Keep original copy')).toBeChecked();
});
