import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AUTH_FILE, BASE_URL, login } from './fixtures.mjs';

async function warmUp() {
  let last;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${BASE_URL}/wp-login.php`);
      if (res.ok) return;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`WordPress not ready at ${BASE_URL}: ${last}`);
}

export default async function globalSetup() {
  await warmUp();
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await login(page);
    await page.context().storageState({ path: AUTH_FILE });
  } finally {
    await browser.close();
  }
}
