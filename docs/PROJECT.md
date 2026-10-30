# Dsquoosh — project brief

> Living document for this repo. Update it when status, layout or conventions
> change. (Last reviewed: 2026-10-30, after the v2 merge.)

## Where this project lives

- **Canonical repository:** https://github.com/sidhanth-povil/Dsquoosh
  (`origin` in git; all branches push there)
- **Release branch:** `main` — feature work ships as branches with PRs into it.
- Branch names follow `feature/<topic>` / `fix/<topic>`, one concern per branch.

## What this is

A WordPress **mu-plugin** (DS WebP Squoosh Studio, v1.2.0) that converts images
to WebP **in the browser before upload**, using Squoosh's libwebp WASM encoder
(vendored `@jsquash/webp` 1.5.0) in a Web Worker pool. Zero server load. Only a
WebP that is **smaller** than the original is uploaded — everything else passes
through unchanged, on any failure, exactly as before. A floating "WebP
converter" panel controls quality and shows per-file results.

The root [`readme.md`](../readme.md) is the user-facing entry point
(install / avoid / options); [`ds-webp-squoosh/readme.md`](../ds-webp-squoosh/readme.md)
is the full plugin documentation.

## Repository layout

```
ds-webp-squoosh/              the shipped plugin (static, no build step)
  ds-webp-squoosh-loader.php  root loader file that must sit in mu-plugins/
  ds-webp-squoosh.php         plugin bootstrap, AJAX vault endpoint, meta, filters
  assets/studio.js            ES-module entry (no bundler)
  assets/lib/                 13 focused modules (settings, classify, pipeline,
                              convert + worker, plupload & REST adapters, vault,
                              preview modal, panel, jobs)
  assets/vendor/@jsquash/webp/  vendored encoder + WASM (Apache-2.0)
  readme.md                   full plugin docs
dev/                          dev-only harness: Docker WP, node --test, Playwright
  e2e/                        Playwright specs + wp-cli fixtures
  tests/                      node unit tests
  mu/ds-dev-no-webp.php       simulates a server with no WebP support
docs/
  superpowers/specs/          design documents ("WebP everywhere" v2)
  superpowers/plans/          checkbox-tracked implementation plans
  PROJECT.md                  this brief
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
size check — any failure keeps the original. PHP persists meta, serves config +
`webpSupported`, disables WP 7.0's experimental client-side media processing,
and vaults originals via a nonce/capability-checked AJAX endpoint into a
tokenized, hardened folder.

## Status (as of 2026-10-30)

- v1 (details panel era) done and merged; **v2 "WebP everywhere" fully
  implemented, tested and merged to `main`** via PR #1 (branch
  `fix/ds-webp-intercept-order` carried the build; the branch name is a
  historical leftover).
- Post-merge review fixes landed: bounded main-thread decode, concurrency cap,
  malformed-GIF handling, unload guard, vault authorization per attachment
  (`edit_post` + one-backup 409), `ds_webp_backup_max_bytes` honoured, and the
  WP 7.0 client-side flag gated on actual server WebP support.
- Unit suite: **47 pass / 10 skipped** — the 10 are PHP integration tests that
  skip automatically while the Docker harness (`localhost:8089`) is down; run
  `bash dev/setup.sh` to exercise them. E2E requires that harness.
- Known cosmetic loose ends: untracked `gemini-chat.txt` scratch file at the
  root (empty; safe to ignore/delete).

## Things to never do here

- Never split `assets/` — the WASM must be beside its ESM module.
- Never add a build step to the shipped plugin; plain ES modules only, files
  small and focused.
- Never ship, deploy or commit the `dev/` folder contents, `.auth/`
  storageState, screenshots, or chat scratch files.
- Never break uploads: any conversion path must fall back to the original on
  failure (this is the project's prime invariant).
- No expando properties on `File` objects — use WeakMaps; no `console.log`
  (use the `[DS WebP Squoosh]`-prefixed info/warn/error helpers).

## How changes are made

1. Branch off `main` (`fix/…` or `feature/…`).
2. Follow the checkbox plans in `docs/superpowers/plans/`, TDD where practical.
3. Verify with `npm --prefix dev run unit` (and, with the harness up,
   `npm --prefix dev run e2e`), then PR into `main`.
4. Update the plugin readme + this brief when behavior or status changes.
