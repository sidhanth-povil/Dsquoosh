import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE } from './e2e/fixtures.mjs';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.mjs',
  workers: 1,
  use: {
    baseURL: 'http://localhost:8089',
    storageState: AUTH_FILE,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
