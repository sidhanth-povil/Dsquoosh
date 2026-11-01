# Dsquoosh — project brief

> Living document for this repo. Update it when status, layout or conventions
> change. (Last reviewed: 2026-11-01, after the v1.2.2 release.)

## Where this project lives

- **Canonical repository:** https://github.com/sidhanth-povil/Dsquoosh
  (`origin` in git; all branches push there)
- **Release branch:** `main`. It is protected by a ruleset: changes land only
  through pull requests (0 approvals required), no force-push, no deletion.
- **Release tags:** `v*` tags can only be created, moved or deleted by repo
  admins (second ruleset). A published release is what every site installs.
- Branch names follow `feature/<topic>` / `fix/<topic>` / `docs/<topic>`, one
  concern per branch.

## What this is

A WordPress **plugin** (DS WebP Squoosh Studio, v1.2.2) that converts images
to WebP **in the browser before upload**, using Squoosh's libwebp WASM encoder
(vendored `@jsquash/webp` 1.5.0) in a Web Worker pool. Zero server load. Only a
WebP that is **smaller** than the original is uploaded — everything else passes
through unchanged, on any failure, exactly as before. A floating "WebP
converter" panel controls quality and shows per-file results.

Since v1.2.1 it ships as a regular plugin (`ds-webp-squoosh.zip` on each GitHub
release) and **updates itself** on every site from this repo's releases. The
older mu-plugin layout still loads but never updates.

The root [`readme.md`](../readme.md) is the user-facing entry point (install,
automatic updates, avoid, options, changelog);
[`ds-webp-squoosh/readme.md`](../ds-webp-squoosh/readme.md) is the full plugin
documentation; [`SECURITY.md`](../SECURITY.md) is the vulnerability-reporting
policy.

## Repository layout

```
ds-webp-squoosh/              the shipped plugin (static, no build step)
  ds-webp-squoosh.php         bootstrap, duplicate-load guard, AJAX vault endpoint, meta, filters
  updater.php                 self-updater: GitHub latest release → core's Update URI hook; forces auto-update
  ds-webp-squoosh-loader.php  legacy mu-plugin install only (excluded from the release zip)
  assets/studio.js            ES-module entry (no bundler)
  assets/lib/                 14 focused modules (settings, classify, pipeline, limiter,
                              convert + worker, plupload & REST adapters, vault,
                              preview modal, panel ×3, jobs)
  assets/vendor/@jsquash/webp/  vendored encoder + WASM (Apache-2.0)
  readme.md                   full plugin docs
.github/workflows/release.yml on release published: version check, build + attach ds-webp-squoosh.zip
dev/                          dev-only harness: Docker WP, node --test, Playwright
  e2e/                        Playwright specs + wp-cli fixtures
  tests/                      node unit + PHP integration tests (php, updater, …)
  mu/ds-dev-no-webp.php       simulates a server with no WebP support
docs/
  superpowers/specs/          design documents ("WebP everywhere" v2)
  superpowers/plans/          checkbox-tracked implementation plans
  PROJECT.md                  this brief
SECURITY.md                   supported versions, private reporting, release protections
```

## Architecture in one paragraph

`studio.js` wires two thin **upload adapters** onto one shared **per-file
pipeline** (`pipeline.js`): the plupload adapter (priority-100 `FilesAdded`
intercept + `wp.Uploader.prototype.init` wrap) covers Add New / Library grid /
media modal / Elementor; the REST adapter is an `apiFetch` middleware that swaps
the `file` in `POST /wp/v2/media` FormData and appends `_ds_webp_quality` /
`_ds_orig_size`. The pipeline classifies (animated-GIF byte parser, web formats,
decodability), optionally previews, encodes in a 3-worker pool
(OffscreenCanvas + jSquash libwebp) or main thread as fallback, and does a
size check — any failure keeps the original. PHP persists meta (only for users
with `upload_files`), serves config + `webpSupported`, disables WP 7.0's
experimental client-side media processing, and vaults originals via a
nonce/capability-checked AJAX endpoint into a tokenized, hardened folder; the
upload is content-checked **before** it is moved (getimagesize, or an
ISO-BMFF `ftyp` HEIF brand for `.heic`/`.heif`). `updater.php` answers
`update_plugins_github.com` from the cached latest GitHub release (6 h, 1 h
after a failure) and only accepts this repo's `ds-webp-squoosh.zip`.

## Releasing

1. Branch, change, test, PR into `main`, merge.
2. Bump **both** `Version:` (header) and `const VERSION` in
   `ds-webp-squoosh.php` — in that PR.
3. `gh release create vX.Y.Z --target main --title "…" --notes-file …`
4. The workflow refuses mismatched versions, then attaches `ds-webp-squoosh.zip`.
   Sites install it within ~12 h (Dashboard → Updates → Check again for now).
5. Test risky builds as a **pre-release** first: sites only follow the latest
   full release.

## Status (as of 2026-11-01)

- **v1.2.2 released** (security hardening from an audit of 1.2.1): HEIF
  signature check, validate-before-move in the vault, `upload_files` guard on
  `add_attachment` meta, checkout pinned by SHA, dev harness bound to
  `127.0.0.1`, nginx vault rule documented.
- v1.2.1: regular-plugin packaging + GitHub self-updater + release workflow.
- Repo hardening: `main` and `v*` tag rulesets, private vulnerability
  reporting, secret scanning + push protection.
- Tests: **64 unit/integration** (PHP ones need the Docker harness up) and
  **43 Playwright e2e**, all passing. The Elementor spec can flake once on a
  cold editor right after the container is recreated.
- **Open:** direct drops onto the Elementor canvas aren't converted yet; sites
  still on the 1.2.0 mu-plugin install must be migrated by hand once; enable
  2FA on the GitHub account that owns releases.

## Things to never do here

- Never split `assets/` — the WASM must be beside its ESM module.
- Never add a build step to the shipped plugin; plain ES modules only, files
  small and focused.
- Never rename the `ds-webp-squoosh/` folder: updates install into it.
- Never publish a release without green tests — it auto-installs everywhere.
- Never ship, deploy or commit the `dev/` folder contents, `.auth/`
  storageState, screenshots, or chat/draft scratch files (root `.gitignore`
  covers the known ones).
- Never break uploads: any conversion path must fall back to the original on
  failure (this is the project's prime invariant).
- No expando properties on `File` objects — use WeakMaps; no `console.log`
  (use the `[DS WebP Squoosh]`-prefixed info/warn/error helpers).

## How changes are made

1. Branch off `main` (`fix/…`, `feature/…` or `docs/…`).
2. Follow the checkbox plans in `docs/superpowers/plans/`, TDD where practical.
3. Verify with `npm --prefix dev run unit` (and, with the harness up,
   `npm --prefix dev run e2e`), then PR into `main`.
4. Update the plugin readme, root changelog and this brief when behavior or
   status changes. Releases follow [Releasing](#releasing).
