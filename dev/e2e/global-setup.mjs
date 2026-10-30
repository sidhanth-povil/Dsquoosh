import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AUTH_FILE, login } from './fixtures.mjs';

export default async function globalSetup() {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await login(page);
  await page.context().storageState({ path: AUTH_FILE });
  await browser.close();
}
