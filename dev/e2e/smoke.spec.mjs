import { test, expect } from '@playwright/test';

test('media-new.php exposes DSWebPConfig with a nonce', async ({ page }) => {
  await page.goto('/wp-admin/media-new.php');
  const nonce = await page.evaluate(() => window.DSWebPConfig && window.DSWebPConfig.nonce);
  expect(nonce).toBeTruthy();
});
