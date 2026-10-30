import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
export const DEV_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'http://localhost:8089';
export const AUTH_FILE = join(DEV_DIR, '.auth', 'admin.json');

/** Run wp-cli in the cli container; resolves stdout, rejects on non-zero exit. */
export async function wp(...args) {
  const { stdout } = await run('docker', [
    'compose', '-p', 'dswebp', '-f', join(DEV_DIR, 'docker-compose.yml'),
    'exec', '-T', 'cli', 'wp', ...args,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** Log in as admin via the wp-login.php form on the given page. */
export async function login(page) {
  await page.goto(`${BASE_URL}/wp-login.php`);
  await page.fill('#user_login', 'admin');
  await page.fill('#user_pass', 'admin');
  await Promise.all([page.waitForURL('**/wp-admin/**', { timeout: 90_000 }), page.click('#wp-submit')]);
}
