import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.mjs',
  workers: 1,
  use: {
    baseURL: 'http://localhost:8089',
    storageState: '.auth/admin.json',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
