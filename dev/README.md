# Dev harness

Dev-only. Nothing here ships with the plugin.

- `bash dev/setup.sh` starts WordPress at http://localhost:8089 (admin/admin), installs it, and prints `CLASS OK` when the mu-plugin loads. The port is bound to `127.0.0.1` only: the throwaway credentials and app passwords over plain http must never be reachable from your network.
- `WP_IMAGE=wordpress:6.5 bash dev/setup.sh` runs against another WP image (default `wordpress:latest`). Tear down first when switching.
- `npm --prefix dev i && npx --prefix dev playwright install chromium` once.
- `npm --prefix dev run unit` runs node tests in `dev/tests` (PHP integration tests skip themselves while the harness is down).
- `npm --prefix dev run e2e [-- smoke]` runs Playwright (logs in once, storageState in `dev/.auth/`).
- `wp(...)` in `dev/e2e/fixtures.mjs` runs wp-cli in the `cli` container.
- `setup.sh` enables Apache `mod_headers` in the wp container so `assets/.htaccess` (Cache-Control: no-cache) is honoured; the unit test checks it. Re-run `setup.sh` after recreating containers.
- `wp option update ds_dev_no_webp 1` simulates a host without server WebP (`dev/mu/ds-dev-no-webp.php`).
- The `cli` service needs the same bind mounts as `wp`, otherwise wp-cli sees no plugin.
- The plugin is mounted as an **mu-plugin**. `tests/updater.test.mjs` copies it into `wp-content/plugins/` to exercise the regular-plugin path: core's update offer, forced auto-updates, and the duplicate-load guard. It removes the copy afterwards.
- **Gotcha:** `ds-webp-squoosh-loader.php` is a single-file bind mount. Anything that replaces the file instead of editing it in place (`sed -i`, `git checkout`, `git pull`) leaves the container on the old copy: PHP warns `Failed opening …/ds-webp-squoosh-loader.php` and the plugin classes go missing. Fix: `docker compose -p dswebp -f dev/docker-compose.yml restart wp cli`.
- Testing a real update locally: serve a built zip from the wp container and allow the internal host just for that command: `wp plugin update ds-webp-squoosh --exec='WP_CLI::add_wp_hook("http_request_host_is_external", "__return_true");'`.
- Teardown: `docker compose -p dswebp -f dev/docker-compose.yml down -v`.
