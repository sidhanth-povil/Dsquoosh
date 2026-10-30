# Dev harness

Dev-only. Nothing here ships with the plugin.

- `bash dev/setup.sh` starts WordPress at http://localhost:8089 (admin/admin), installs it, and prints `CLASS OK` when the mu-plugin loads.
- `WP_IMAGE=wordpress:6.5 bash dev/setup.sh` runs against another WP image (default `wordpress:latest`). Tear down first when switching.
- `npm --prefix dev i && npx --prefix dev playwright install chromium` once.
- `npm --prefix dev run unit` runs node tests in `dev/tests`.
- `npm --prefix dev run e2e [-- smoke]` runs Playwright (logs in once, storageState in `dev/.auth/`).
- `wp(...)` in `dev/e2e/fixtures.mjs` runs wp-cli in the `cli` container.
- `setup.sh` enables Apache `mod_headers` in the wp container so `assets/.htaccess` (Cache-Control: no-cache) is honoured; the unit test checks it.
- `wp option update ds_dev_no_webp 1` simulates a host without server WebP (`dev/mu/ds-dev-no-webp.php`).
- The `cli` service needs the same bind mounts as `wp`, otherwise wp-cli sees no plugin.
- Teardown: `docker compose -p dswebp -f dev/docker-compose.yml down -v`.
