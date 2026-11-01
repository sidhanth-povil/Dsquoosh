import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { BASE_URL, DEV_DIR, wp } from '../e2e/fixtures.mjs';

const up = await fetch(`${BASE_URL}/wp-login.php`).then((r) => r.ok, () => false);
const opts = up ? {} : { skip: `${BASE_URL} is down (run bash dev/setup.sh)` };

const run = promisify(execFile);
const sh = (cmd) => run('docker', ['compose', '-p', 'dswebp', '-f', join(DEV_DIR, 'docker-compose.yml'), 'exec', '-T', 'cli', 'sh', '-c', cmd]);

const REPO_DL = 'https://github.com/sidhanth-povil/Dsquoosh/releases/download';
const release = (tag, url = `${REPO_DL}/${tag}/ds-webp-squoosh.zip`, name = 'ds-webp-squoosh.zip') =>
  ({ tag_name: tag, assets: [{ name: 'other.zip', browser_download_url: `${REPO_DL}/${tag}/other.zip` }, { name, browser_download_url: url }] });

/** Runs PHP in WordPress with `$in` = the JSON-decoded argument; returns its JSON-decoded echo. */
const php = async (code, input = null) =>
  JSON.parse(await wp('eval', `$in = json_decode(${JSON.stringify(JSON.stringify(input))}, true); ${code}`));

const parse = (body) => php('echo wp_json_encode( DS_WebP_Squoosh_Updater::parse_release( $in ) );', body);
const seedCache = (value) => php(`set_site_transient( 'ds_webp_squoosh_release', $in, 600 ); echo 1;`, value);

before(async () => {
  if (!up) return;
  // Second copy as a regular plugin next to the mu-plugin: exercises core's update path + the duplicate-load guard.
  await sh('cp -r /var/www/html/wp-content/mu-plugins/ds-webp-squoosh /var/www/html/wp-content/plugins/');
  await sh('rm -f /var/www/html/wp-content/plugins/ds-webp-squoosh/ds-webp-squoosh-loader.php');
});

after(async () => {
  if (!up) return;
  await wp('plugin', 'deactivate', 'ds-webp-squoosh').catch(() => {});
  await sh('rm -rf /var/www/html/wp-content/plugins/ds-webp-squoosh');
  await wp('transient', 'delete', 'ds_webp_squoosh_release', '--network').catch(() => {});
  await wp('transient', 'delete', 'update_plugins', '--network').catch(() => {});
});

test('parse_release reads version + package from a release with our asset', opts, async () => {
  assert.deepEqual(await parse(release('v1.3.0')), {
    version: '1.3.0',
    package: `${REPO_DL}/v1.3.0/ds-webp-squoosh.zip`,
    url: 'https://github.com/sidhanth-povil/Dsquoosh/releases/tag/v1.3.0',
  });
});

test('parse_release rejects non-numeric tags, missing asset and foreign download URLs', opts, async () => {
  assert.equal(await parse(release('nightly')), null);
  assert.equal(await parse(release('v1.3.0', undefined, 'ds-webp-squoosh-1.3.0-mu-plugins.zip')), null);
  assert.equal(await parse(release('v1.3.0', 'https://evil.example/ds-webp-squoosh.zip')), null);
  assert.equal(await parse({ message: 'Not Found' }), null);
});

test('activating the regular plugin while the mu-plugin is loaded does not fatal', opts, async () => {
  await wp('plugin', 'activate', 'ds-webp-squoosh');
  assert.match(await wp('plugin', 'status', 'ds-webp-squoosh'), /Status: Active/);
});

test('core offers the GitHub release as an update with auto-update forced on', opts, async () => {
  await seedCache({ version: '9.9.9', package: `${REPO_DL}/v9.9.9/ds-webp-squoosh.zip`, url: 'https://github.com/x' });
  await wp('transient', 'delete', 'update_plugins', '--network');

  const [row] = JSON.parse(await wp('plugin', 'list', '--name=ds-webp-squoosh', '--fields=update,update_version,update_package', '--format=json'));
  assert.equal(row.update, 'available');
  assert.equal(row.update_version, '9.9.9');
  assert.equal(row.update_package, `${REPO_DL}/v9.9.9/ds-webp-squoosh.zip`);

  // wp-cli's auto_update column reads only the stored option; ask core's background updater instead.
  const shouldUpdate = (plugin) => php(`require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
    echo wp_json_encode( ( new WP_Automatic_Updater() )->should_update( 'plugin', (object) [ 'plugin' => $in, 'new_version' => '9.9.9' ], WP_PLUGIN_DIR ) );`, plugin);
  assert.equal(await shouldUpdate('ds-webp-squoosh/ds-webp-squoosh.php'), true);
  assert.equal(await shouldUpdate('hello.php'), false);
});

test('no update offered when the cached lookup failed', opts, async () => {
  await seedCache({ version: '' });
  await wp('transient', 'delete', 'update_plugins', '--network');

  const [row] = JSON.parse(await wp('plugin', 'list', '--name=ds-webp-squoosh', '--fields=update', '--format=json'));
  assert.equal(row.update, 'none');
});
