# DS WebP v2 "WebP everywhere" Implementation Plan

> **Status: EXECUTED & SHIPPED** — all tasks completed on 2026-10-30; review-fix
> commits (`f3797b2`, `f5bbf23`, `f3eabbb`, `6f4a28b`) landed after it and
> everything is merged to `main` via PR #1. See `docs/PROJECT.md` for status.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every normal image uploaded anywhere in wp-admin (Add New, Library grid, media modal, Elementor modal, block/site editor drops) to WebP in the browser, controlled from one floating panel.

**Architecture:** One shared per-file pipeline (classify → optional preview → convert in a Web Worker → size check) produces an immutable `Result`. Two thin adapters feed it: the existing plupload intercept (priority-100 `FilesAdded`) and a new `apiFetch` middleware for `POST /wp/v2/media`. A job store drives the floating panel UI. PHP gains REST-path meta, a `webpSupported` flag, vault formats, and disables WP 7.0 client-side media processing while active.

**Tech Stack:** WordPress mu-plugin (PHP 7.4+), plain ES modules (no build), vendored `@jsquash/webp` 1.5.0, Web Workers + OffscreenCanvas; dev-only: Docker (wordpress + mariadb + wp-cli), `node --test`, Playwright via `npx`.

**Spec:** `docs/superpowers/specs/2026-10-30-ds-webp-everywhere-design.md`

## Global Constraints

- Shipped plugin has no build step and no npm deps; everything under `ds-webp-squoosh/` is served statically. Dev tooling lives only in `dev/`.
- Minimum WordPress 6.4. Script modules only for WP ≥ 6.6 (`version_compare( get_bloginfo( 'version' ), '6.6', '>=' )`); below that, classic handle printed as `type="module"`.
- Defaults unchanged: quality 82, max edge 2460 px, filters `ds_webp_default_quality`, `ds_webp_max_dim`, `ds_webp_keep_original`, `ds_webp_backup_max_bytes`.
- Presets: Smallest 60 / Balanced 82 / Sharp 92.
- Convert: JPEG, PNG, BMP, static GIF, any other raster the browser decodes. Pass through: WebP, AVIF, SVG, animated GIF, non-images, undecodable.
- A WebP not smaller than its original is never uploaded; the original goes instead.
- Post meta keys unchanged: `_ds_webp_quality`, `_ds_orig_size`, `_ds_original_backup`. Request fields unchanged: `_ds_webp_quality`, `_ds_orig_size`.
- Panel copy (exact): title "WebP converter"; switch "Convert uploads to WebP"; checkboxes "Keep original copy", "Preview each image before upload"; reasons "Animated — uploaded as is", "WebP was larger — original uploaded", "Couldn't convert — original uploaded"; server banner "This server can't process WebP — uploading originals"; footer "✓ {n} of {total} converted · saved {size}".
- Immutability: modules return new objects; no expando properties on `File` objects (use `WeakMap`s keyed by File).
- Files ≤ 400 lines, functions < 50 lines. No `console.log` (keep existing `console.info/warn/error` with `[DS WebP Squoosh]` prefix).
- Version bump to 1.2.0 (header + `VERSION`).

## Review Focus

1. **Same file dropped twice / two batches overlapping** → each converts once, no duplicate attachments. Test in Task 4 e2e (`overlapping batches`).
2. **Huge image (e.g. 8000×6000 PNG)** → downscaled to 2460 longest edge, page stays responsive. Test in Task 3 (`downscales to maxDim`).
3. **Encoder/worker fails to load (wasm 404, CSP)** → every file uploads as original with "Couldn't convert" reason; no stuck tiles. Test in Task 3 (`convert rejects → failed`) + Task 4 e2e with wasm route aborted.
4. **Conversion disabled mid-batch** → files already queued follow the queue-time snapshot. Test in Task 3 (`settings snapshot at enqueue`).
5. **Preview modal cancelled ("Upload original") on the REST path** → original uploads, block not stuck. Test in Task 6 e2e (`preview skip in block editor`).

---

## File Structure

```
ds-webp-squoosh/
  ds-webp-squoosh.php            modify: config flags, enqueue switch, REST meta, CSMP disable, vault formats
  assets/studio.js               rewrite: entry only — reads config, wires modules (~80 lines)
  assets/studio.css              rewrite: panel + editor button + modal + details row
  assets/lib/settings.js         create: settings store, presets, persistence
  assets/lib/classify.js         create: should-convert decision + animated GIF parser
  assets/lib/convert.js          create: worker pool + main-thread fallback
  assets/lib/convert-worker.js   create: decode/downscale/encode inside a worker
  assets/lib/pipeline.js         create: processFile → Result
  assets/lib/jobs.js             create: immutable job store for the panel
  assets/lib/plupload-adapter.js create: moved/adapted plupload intercept
  assets/lib/rest-adapter.js     create: apiFetch middleware
  assets/lib/vault.js            create: Keep Original AJAX upload
  assets/lib/preview-modal.js    create: moved preview modal
  assets/lib/panel.js            create: floating panel, badge, editor toolbar button
dev/
  docker-compose.yml, setup.sh, README.md, mu/ds-dev-no-webp.php
  package.json (devDeps: @playwright/test), playwright.config.mjs
  tests/*.test.mjs               node --test unit tests
  e2e/fixtures.mjs, e2e/*.spec.mjs
```

---

### Task 1: Dev harness (Docker + test runners)

**Files:**
- Create: `dev/docker-compose.yml`, `dev/setup.sh`, `dev/mu/ds-dev-no-webp.php`, `dev/package.json`, `dev/playwright.config.mjs`, `dev/tests/smoke.test.mjs`, `dev/e2e/smoke.spec.mjs`, `dev/README.md`

**Interfaces:**
- Produces: WP at `http://localhost:8089` (admin/admin); `WP_IMAGE` env selects image tag (default `wordpress:latest`, `wordpress:6.5` for fallback runs); `npm --prefix dev run unit` → `node --test dev/tests`; `npm --prefix dev run e2e` → Playwright; option `ds_dev_no_webp=1` makes `wp_image_editors` return `[]`; helper `wp(...args)` in `dev/e2e/fixtures.mjs` runs wp-cli via `docker compose -p dswebp exec -T cli wp`.

- [ ] **Step 1:** Write `docker-compose.yml`: services `db` (mariadb:11), `wp` (`${WP_IMAGE:-wordpress:latest}`, port 8089), `cli` (wordpress:cli, user 33:33, `sleep infinity`). Bind-mount `../ds-webp-squoosh` → `wp-content/mu-plugins/ds-webp-squoosh`, the loader → `wp-content/mu-plugins/ds-webp-squoosh-loader.php`, `./mu/ds-dev-no-webp.php` → `wp-content/mu-plugins/ds-dev-no-webp.php` **in both `wp` and `cli`** (cli without the mounts silently sees an empty plugin).
- [ ] **Step 2:** Write `setup.sh`: compose up, wait for DB, `wp core install --url=http://localhost:8089 --admin_user=admin --admin_password=admin …`, then `wp eval 'echo class_exists("DS_WebP_Squoosh_Studio") ? "CLASS OK" : "NO CLASS";'`.
- [ ] **Step 3:** Write `ds-dev-no-webp.php`: if `get_option( 'ds_dev_no_webp' )`, `add_filter( 'wp_image_editors', '__return_empty_array' )`.
- [ ] **Step 4:** `dev/tests/smoke.test.mjs` asserts the vendored encoder module path exists. `dev/e2e/smoke.spec.mjs` logs in (`globalSetup` saves `storageState`) and asserts `media-new.php` has `window.DSWebPConfig.nonce`.
- [ ] **Step 5:** Run `bash dev/setup.sh` → `CLASS OK`; `npm --prefix dev i && npx --prefix dev playwright install chromium`; `npm --prefix dev run unit` → PASS; `npm --prefix dev run e2e -- smoke` → PASS.
- [ ] **Step 6:** README documents the above, the `WP_IMAGE` switch, teardown `docker compose -p dswebp down -v`. Commit `test: add Docker + node/Playwright dev harness`.

### Task 2: Settings store and classifier

**Files:**
- Create: `ds-webp-squoosh/assets/lib/settings.js`, `ds-webp-squoosh/assets/lib/classify.js`, `dev/tests/gif-bytes.mjs`
- Test: `dev/tests/settings.test.mjs`, `dev/tests/classify.test.mjs`

**Interfaces:**
- Produces:
  - `PRESETS = Object.freeze({ smallest: 60, balanced: 82, sharp: 92 })`
  - `presetFor(quality: number): 'smallest'|'balanced'|'sharp'|null`
  - `clampInt(value, min, max, fallback): number`
  - `createSettings(config: { defaultQuality, defaultBackup }, storage = globalThis.localStorage): { get(): Settings, set(partial): Settings, subscribe(fn: (s: Settings) => void): () => void }` — `Settings = Readonly<{ enabled: boolean, quality: number, keepOriginal: boolean, preview: boolean }>`; storage key `dsWebpSettings`; storage errors swallowed.
  - `classifyFile(file: File, { canDecode: (file) => Promise<boolean> }): Promise<{ convert: boolean, reason: null|'not-image'|'web-format'|'animated'|'undecodable' }>`
  - `isAnimatedGif(bytes: Uint8Array): boolean`
  - `dev/tests/gif-bytes.mjs`: `STATIC_GIF` (1×1, one frame), `ANIMATED_GIF` (1×1, two frames + NETSCAPE2.0 loop extension), as `Uint8Array` literals (reused by e2e fixtures).

- [ ] **Step 1: Write failing tests**

```js
test('set returns a new frozen object and persists', () => {
  const store = memoryStorage();
  const s = createSettings({ defaultQuality: 82, defaultBackup: false }, store);
  const before = s.get();
  const after = s.set({ quality: 60 });
  assert.notEqual(before, after); assert.equal(before.quality, 82);
  assert.ok(Object.isFrozen(after));
  assert.equal(JSON.parse(store.getItem('dsWebpSettings')).quality, 60);
});
test('quality clamps to 1..100; non-numeric keeps previous', ...);   // set({quality:500}) → 100
test('presetFor maps 60/82/92, null for 70', ...);
test('throwing storage does not break get/set', ...);
test('saved settings override config defaults', ...);

test('webp, avif, svg pass through as web-format', async () => {
  for (const type of ['image/webp', 'image/avif', 'image/svg+xml'])
    assert.deepEqual(await classifyFile(new File(['x'], 'a', { type }), { canDecode: async () => true }),
      { convert: false, reason: 'web-format' });
});
test('text/plain → not-image', ...);
test('jpeg, png, bmp decodable → convert', ...);
test('image/heic with canDecode false → undecodable', ...);
test('ANIMATED_GIF → animated; STATIC_GIF → convert', ...);
test('isAnimatedGif skips extension sub-blocks and local color tables', ...);
```

- [ ] **Step 2:** `npm --prefix dev run unit` → FAIL (modules not found).
- [ ] **Step 3:** Implement. `isAnimatedGif` walks the block structure: 6-byte header, 7-byte logical screen descriptor (+ global color table `3 * 2^((flags & 7) + 1)` bytes if `flags & 0x80`); loop on introducer — `0x21`: skip label byte then sub-blocks until a 0 length; `0x2C`: count++, skip 9 bytes (+ local color table when flagged), 1 LZW byte, sub-blocks; `0x3B`: stop; return `count > 1` (return early at 2). Classifier order: not `image/*` → `not-image`; webp/avif/svg → `web-format`; gif → `isAnimatedGif(bytes)` → `animated`; `canDecode` false → `undecodable`; else `{ convert: true, reason: null }`.
- [ ] **Step 4:** `npm --prefix dev run unit` → PASS.
- [ ] **Step 5:** Commit `feat: settings store with presets and image classifier`.

### Task 3: Converter (worker pool), pipeline, job store

**Files:**
- Create: `ds-webp-squoosh/assets/lib/convert-worker.js`, `ds-webp-squoosh/assets/lib/convert.js`, `ds-webp-squoosh/assets/lib/pipeline.js`, `ds-webp-squoosh/assets/lib/jobs.js`
- Test: `dev/tests/pipeline.test.mjs`, `dev/tests/jobs.test.mjs`, `dev/e2e/convert.spec.mjs`

**Interfaces:**
- Consumes: `classifyFile`, `Settings` (Task 2).
- Produces:
  - Worker protocol: in `{ id: number, file: File, quality: number, maxDim: number }`; out `{ id, ok: true, buffer: ArrayBuffer, width, height } | { id, ok: false, error: string }`.
  - `decodeAndEncode(file: File, quality: number, maxDim: number): Promise<{ buffer: ArrayBuffer, width: number, height: number }>` exported from `convert-worker.js` (used by the worker and the main-thread fallback).
  - `createConverter({ maxDim: number, poolSize?: number }): { convert(file: File, quality: number): Promise<Blob>, canDecode(file: File): Promise<boolean>, dispose(): void }` — pool size `Math.min(3, navigator.hardwareConcurrency || 2)`; worker `new Worker(new URL('./convert-worker.js', import.meta.url), { type: 'module' })`; falls back to main thread when `Worker`/`OffscreenCanvas` are missing or a worker errors on start.
  - `Result = Readonly<{ original: File, file: File, converted: boolean, reason: null|'disabled'|'server-no-webp'|'not-image'|'web-format'|'animated'|'undecodable'|'larger'|'failed'|'skipped-preview', quality: number|null, origSize: number }>`
  - `processFile(original: File, ctx: { settings: Settings, serverSupportsWebp: boolean, classify: (f: File) => Promise<{convert, reason}>, convert: (f: File, q: number) => Promise<Blob>, preview?: (f: File, q: number) => Promise<{ blob: Blob, quality: number }|null>, onStage?: (stage: 'converting'|'done', result?: Result) => void }): Promise<Result>` — never rejects. Converted name: basename with last extension replaced by `.webp` (`photo.final.JPG` → `photo.final.webp`), type `image/webp`.
  - `createJobStore(): { add(name: string, size: number): number, update(id: number, patch: object): void, snapshot(): ReadonlyArray<Job>, subscribe(fn): () => void, clear(): void }` — `Job = Readonly<{ id, name, size, status: 'waiting'|'converting'|'done', result: Result|null }>`.

- [ ] **Step 1: Write failing tests**

```js
const webp = (n) => async () => new Blob([new Uint8Array(n)], { type: 'image/webp' });
const jpg = new File([new Uint8Array(1000)], 'photo.final.JPG', { type: 'image/jpeg' });
const base = { settings: { enabled: true, quality: 82, keepOriginal: false, preview: false },
  serverSupportsWebp: true, classify: async () => ({ convert: true, reason: null }) };

test('smaller webp → converted result with .webp name', async () => {
  const r = await processFile(jpg, { ...base, convert: webp(400) });
  assert.equal(r.converted, true); assert.equal(r.file.name, 'photo.final.webp');
  assert.equal(r.file.type, 'image/webp'); assert.equal(r.quality, 82); assert.equal(r.origSize, 1000);
});
test('webp not smaller → original, reason larger', ...);        // webp(1000)
test('convert rejects → original, reason failed', ...);
test('disabled → reason disabled, convert never called', ...);
test('server without webp → reason server-no-webp', ...);
test('classifier animated → reason animated', ...);
test('preview null → skipped-preview; preview blob+quality used when returned', ...);
test('settings snapshot at enqueue: caller mutating settings after call has no effect', ...);
test('job store: add/update give new frozen snapshots and notify subscribers', ...);
```

`dev/e2e/convert.spec.mjs` (real Chromium on an admin page, module imported by URL): `downscales to maxDim` (8000×6000 PNG → decoded 2460×1845), `worker output is RIFF/WEBP`, `main-thread fallback when Worker is undefined`.

- [ ] **Step 2:** Run unit + `e2e -- convert` → FAIL.
- [ ] **Step 3:** Implement. Worker: `createImageBitmap(file)` → scale `min(1, maxDim / max(w, h))` → `OffscreenCanvas` → `getImageData` → `encode(imageData, { quality, method: 4 })` from `../vendor/@jsquash/webp/index.js`; post with the buffer transferred. `processFile` copies `ctx.settings` at entry, order: disabled → server-no-webp → classify → preview (when `settings.preview`) → convert → size check; any throw → `failed`.
- [ ] **Step 4:** Unit + `e2e -- convert` → PASS.
- [ ] **Step 5:** Commit `feat: worker-pool converter and shared upload pipeline`.

### Task 4: Plupload adapter on the pipeline (Add New, Library, media modal, Elementor)

**Files:**
- Create: `ds-webp-squoosh/assets/lib/plupload-adapter.js`, `ds-webp-squoosh/assets/lib/vault.js`, `ds-webp-squoosh/assets/lib/preview-modal.js`, `dev/e2e/fixtures.mjs`
- Rewrite: `ds-webp-squoosh/assets/studio.js` (entry; panel wired in Task 7)
- Test: `dev/e2e/plupload.spec.mjs`

**Interfaces:**
- Consumes: `processFile`, `createConverter`, `createSettings`, `classifyFile`, `createJobStore`.
- Produces:
  - `installPluploadAdapter({ process: (file: File) => Promise<Result>, onUploaded: (result: Result, attachmentId: number) => void }): void` — wraps `wp.Uploader.prototype.init` synchronously at module evaluation (poll if `wp.Uploader` isn't defined yet), binds `window.uploader` on `load`, binds `FilesAdded` at priority `100` and returns `false` for batches containing `image/*` files (logic from `interceptAddedFiles` on branch `fix/ds-webp-intercept-order`). Non-images re-add immediately; each image re-adds as `result.file` once processed. A `WeakMap<File, Result>` carries quality/origSize to `BeforeUpload` (`multipart_params._ds_webp_quality` / `_ds_orig_size`, deleted for non-converted) and to `FileUploaded`.
  - `vaultOriginal({ ajaxUrl, nonce }, attachmentId: number, original: File): Promise<boolean>` — action `ds_save_original_backup`, fields as today.
  - `openPreviewModal(file: File, quality: number, encode: (file: File, q: number) => Promise<Blob>): Promise<{ blob: Blob, quality: number }|null>` — existing modal, moved; encodes via the converter.
  - Entry `studio.js` exposes `process(file)` = `processFile(file, { settings: settings.get(), serverSupportsWebp: config.webpSupported !== false, classify: (f) => classifyFile(f, converter), convert: converter.convert, preview: (f, q) => openPreviewModal(f, q, converter.convert), onStage })` and `onUploaded(result, id)` = vault when `result.converted` and the queue-time `keepOriginal` was true (keep a `WeakMap<File, boolean>` snapshot).

- [ ] **Step 1: Write failing e2e tests.** `fixtures.mjs`: `jpeg(page, w, h)` / `png(page, w, h)` via in-page canvas `toBlob` → `{ name, mimeType, buffer }`; `bmp(w, h)` 24-bit BMP built in Node; `STATIC_GIF`/`ANIMATED_GIF` from `dev/tests/gif-bytes.mjs`; `svg()`; `attachments()` = `wp post list --post_type=attachment --fields=ID,post_title,post_mime_type --format=json`. Each test uses `setInputFiles` on the uploader's real hidden `input[type=file]` and waits until `wp.Uploader.queue` is empty.

```js
test('add new: jpg+png+bmp+static gif → 4 image/webp attachments, 0 originals', ...);
test('add new: svg, animated gif, webp upload unchanged', ...);
test('library grid converts (uploader built at DOM-ready)', ...);
test('media modal opened later converts', ...);
test('overlapping batches: second batch mid-encode → each file once, 0 image/jpeg', ...);
test('no stuck tiles: no queue model with uploading:true after settle', ...);
test('webp larger than original (8x8 png) → original uploaded', ...);
test('encoder fails (route **/webp_enc*.wasm aborted) → originals uploaded, no stuck tiles', ...);
test('keep original → _ds_original_backup set, file present, removed on delete', ...);
test('meta: _ds_webp_quality=82 and _ds_orig_size=original bytes', ...);
```

- [ ] **Step 2:** `npm --prefix dev run e2e -- plupload` → FAIL (BMP/GIF not converted; larger webp uploaded).
- [ ] **Step 3:** Implement; delete the old control-bar code from `studio.js`.
- [ ] **Step 4:** `npm --prefix dev run e2e -- plupload` and `npm --prefix dev run unit` → PASS.
- [ ] **Step 5:** Commit `feat: plupload adapter on shared pipeline (all formats, larger-webp fallback)`.

### Task 5: PHP — config flags, REST meta, client-side processing, vault formats, enqueue floor

**Files:**
- Modify: `ds-webp-squoosh/ds-webp-squoosh.php` (constructor hooks; `enqueue_studio_assets`; `save_compression_metadata`; vault whitelist and integrity check in `ajax_save_original_backup`)
- Test: `dev/tests/php.test.mjs` (curl + wp-cli against the harness; `test.skip` with a message when `localhost:8089` is down)

**Interfaces:**
- Produces:
  - `DSWebPConfig.webpSupported: bool` = `wp_image_editor_supports( [ 'mime_type' => 'image/webp' ] )`.
  - `save_rest_compression_metadata( WP_Post $attachment, WP_REST_Request $request, bool $creating )` on `rest_after_insert_attachment`: when `$creating`, reads `_ds_webp_quality` (1–100) and `_ds_orig_size` (absint) via `$request->get_param()`; both paths call private `store_compression_meta( int $id, $quality, $orig_size )`.
  - In `admin_head` (priority 0) and the Elementor editor head, for users who can `upload_files`: print `window.__clientSideMediaProcessing = false;` and the `window.DSWebPConfig = {…};` inline script via `wp_print_inline_script_tag` (moved out of the enqueue callback so it lands inside `<head>` everywhere).
  - Vault extensions: `jpg jpeg png gif bmp tif tiff heic heif`; when `getimagesize` returns data its MIME must be one of `image/jpeg image/png image/gif image/bmp image/x-ms-bmp image/tiff`; HEIC/HEIF skip the check; `getimagesize` returning false for a non-HEIC file → reject (415).
  - Script-module branch only when WP ≥ 6.6.

- [ ] **Step 1: Write failing tests** (setup: `wp user application-password create admin dswebp --porcelain`)

```js
test('REST upload with _ds fields stores meta', ...);   // curl -u admin:$APP -F file=@x.webp -F _ds_webp_quality=70 -F _ds_orig_size=1234 /wp-json/wp/v2/media → meta 70 / 1234
test('REST upload without fields stores no _ds meta', ...);
test('config webpSupported true; false after wp option update ds_dev_no_webp 1', ...);
test('post-new.php prints __clientSideMediaProcessing = false before wp-block-editor script', ...);
test('vault accepts gif and bmp; rejects text renamed .jpg', ...);
```

- [ ] **Step 2:** `npm --prefix dev run unit` → the five new tests FAIL.
- [ ] **Step 3:** Implement; bump `Version`/`VERSION` to `1.2.0`.
- [ ] **Step 4:** Unit → PASS; `WP_IMAGE=wordpress:6.5 bash dev/setup.sh && npm --prefix dev run e2e -- smoke` → PASS and the page has `<script type="module" … studio.js`.
- [ ] **Step 5:** Commit `feat: REST-path meta, webpSupported flag, broader vault formats`.

### Task 6: Block editor REST adapter

**Files:**
- Create: `ds-webp-squoosh/assets/lib/rest-adapter.js`
- Modify: `ds-webp-squoosh/assets/studio.js` (install when `window.wp?.apiFetch?.use` exists; poll briefly otherwise)
- Test: `dev/e2e/block-editor.spec.mjs`

**Interfaces:**
- Consumes: `process`, `onUploaded` (Task 4 entry), REST meta (Task 5).
- Produces: `installRestAdapter({ apiFetch, process, onUploaded }): void` — one middleware `(options, next)`. Acts only when `String(options.method).toUpperCase() === 'POST'`, `options.path || options.url` matches `/wp/v2/media` with no id segment and no `/sideload`, and `options.body instanceof FormData` has a `File` under `file`. Builds a **new** `FormData` (copy all entries, `file` → `result.file`, append `_ds_webp_quality`/`_ds_orig_size` when converted), returns `next({ ...options, body })`, then calls `onUploaded(result, response.id)` on resolve. Any adapter error → `next(options)` untouched.

- [ ] **Step 1: Write failing e2e tests.** Open `post-new.php`, close the welcome guide, dispatch a `drop` with a `DataTransfer` on the canvas (inside `iframe[name="editor-canvas"]` when present), wait for the image block `img`:

```js
test('jpg dropped on canvas → img src ends .webp; attachment image/webp with meta', ...);
test('animated gif dropped → stays image/gif', ...);
test('png via Image block placeholder Upload → webp', ...);
test('preview skip in block editor → original uploaded, block not stuck', ...);
test('keep original works on REST path', ...);
test('window.__clientSideMediaProcessing === false in editor', ...);
```

- [ ] **Step 2:** `npm --prefix dev run e2e -- block-editor` → FAIL (jpg uploaded).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm --prefix dev run e2e` (all) → PASS.
- [ ] **Step 5:** Commit `feat: convert block-editor uploads via apiFetch middleware`.

### Task 7: Floating panel UI + editor toolbar button

**Files:**
- Create: `ds-webp-squoosh/assets/lib/panel.js`
- Rewrite: `ds-webp-squoosh/assets/studio.css` (drop `.ds-webp-bar*`; keep `.ds-webp-modal*`, `.ds-webp-details*`)
- Modify: `ds-webp-squoosh/assets/studio.js` (mount panel; feed jobs from `onStage`)
- Test: `dev/e2e/panel.spec.mjs`

**Interfaces:**
- Consumes: settings store, `PRESETS`, `presetFor`, job store, `config.webpSupported`.
- Produces: `mountPanel({ settings, jobs, presets, webpSupported, uploadHostSelector }): { open(expanded?: boolean): void, destroy(): void }` and `mountEditorButton(panel): void`, with `uploadHostSelector = '.upload-ui, #plupload-upload-ui, .media-frame-uploader, .uploader-inline'`.
  - Root `<section class="ds-webp-panel" aria-label="WebP converter">`, fixed bottom-right, `z-index: 170000` (above media modal 160000). States: hidden / collapsed (header + badge) / expanded (settings) / progress list.
  - Collapsed while any `uploadHostSelector` element is visible (MutationObserver + `offsetParent` check); hidden otherwise unless jobs exist.
  - Badge `<button class="ds-webp-panel__badge" aria-expanded>`: `⚡ {q}%`, or `⚡ off` when disabled.
  - Settings: switch (`role="switch"`), presets as a radio group (none checked when `presetFor` → null), range 1–100 with live `{q}%`, two checkboxes; all through `settings.set`.
  - Rows from `jobs.snapshot()`: name; `{orig} → {webp} · −{pct}%` when converted; progress bar while converting; `Waiting…`; reason copy from Global Constraints. Footer summary. List has `aria-live="polite"`.
  - `webpSupported === false`: banner text from Global Constraints, switch disabled.
  - Auto-hide 4 s after all jobs are done (cancelled while hovered, focused or expanded); `jobs.clear()` on hide.
  - Editor button: on `body.block-editor-page` or `body.site-editor-php`, insert `<button class="ds-webp-editor-btn">⚡ WebP · {q}%</button>` into `.editor-header__settings` (fallback `.edit-post-header__settings`; re-insert via MutationObserver if React re-renders); click → `panel.open(true)`.
  - Motion 150 ms slide/fade, none under `prefers-reduced-motion: reduce`. Colors: header `#1d2327`, accent `#2271b1`, success `#00a32a`, warning `#b32d2e`.

- [ ] **Step 1: Write failing e2e tests**

```js
test('collapsed badge visible on media-new.php, absent on dashboard', ...);
test('badge toggles settings and aria-expanded', ...);
test('Smallest preset → quality 60, slider label 60%', ...);
test('slider 70 → no preset checked, badge ⚡ 70%', ...);
test('upload 2 jpgs → two rows with savings, footer "✓ 2 of 2 converted"', ...);
test('animated gif row reads "Animated — uploaded as is"', ...);
test('auto-hides ~4s after done, stays while hovered', ...);
test('ds_dev_no_webp=1 → banner shown, switch disabled, originals uploaded', ...);
test('editor toolbar button opens panel expanded', ...);
test('keyboard: Tab reaches badge, Enter expands, Space toggles switch', ...);
test('settings persist across reload', ...);
```

- [ ] **Step 2:** `npm --prefix dev run e2e -- panel` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm --prefix dev run unit && npm --prefix dev run e2e` → PASS; save screenshots (collapsed, expanded, progress, editor button) to `dev/e2e/__screens__/` for human review.
- [ ] **Step 5:** Commit `feat: floating WebP panel with presets, progress and editor button`.

### Task 8: Docs and release check

**Files:**
- Modify: `ds-webp-squoosh/readme.md` (behavior table, formats, panel, block editor, server-no-WebP, WP 6.4+, 1.2.0; remove control-bar text)

- [ ] **Step 1:** Update readme.
- [ ] **Step 2:** Add `dev/e2e/elementor.spec.mjs` (runs only when `wp plugin is-active elementor`): `wp plugin install elementor --activate`, create a page, open `post.php?post={id}&action=elementor`, add an Image widget, open its media modal, upload a jpg → attachment `image/webp`, panel badge visible inside the editor.
- [ ] **Step 3:** Full unit + e2e on latest and on `WP_IMAGE=wordpress:6.5` → PASS on both; note results in the PR description.
- [ ] **Step 4:** Commit `docs: v1.2.0 readme` (with the Elementor spec).
