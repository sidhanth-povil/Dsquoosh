# DS WebP Squoosh Studio v2 — "WebP everywhere" design

Date: 2026-10-30 · Status: draft for approval

## Intent

Every normal image a team member uploads anywhere in wp-admin becomes a WebP
automatically, converted in that person's browser (Squoosh's libwebp WASM, zero
server load), with a clear, good-looking control over quality. Uploads must
never break because of this plugin.

## Goals

1. **Coverage — every upload path in the dashboard:**
   - Media → Add New (`media-new.php`, standalone plupload).
   - Media Library grid (`upload.php`) drag-and-drop / Select Files.
   - Media modal (post editor "Add media", featured image, any `wp.media()` frame).
   - Elementor editor media modal (same `wp.media` frame, inside the Elementor editor page).
   - Block editor / site editor direct uploads: dropping onto the canvas, an
     Image/Gallery/Cover block placeholder, the block "Upload" button. These go
     through `@wordpress/media-utils` `uploadToServer()` →
     `apiFetch({ path: '/wp/v2/media…', method: 'POST', body: FormData('file') })`
     and never touch plupload — currently **not covered**.
2. **Formats converted:** JPEG, PNG, BMP, static (single-frame) GIF, and any
   other raster the browser can decode (e.g. HEIC on Safari, TIFF on Safari).
   *Builder's call:* detection by decodability (`createImageBitmap` succeeds),
   not only by extension.
3. **Never convert / pass through untouched:** WebP, AVIF (already web formats),
   SVG, animated GIF (animation would be lost), non-images, anything the browser
   can't decode.
4. **UI — one floating panel ("WebP converter"), chosen layout C + B:**
   - A dark header with title and a badge "⚡ 82% ▾". Clicking the badge
     expands/collapses a settings section inside the same panel.
   - Settings: on/off switch "Convert uploads to WebP"; quality presets
     Smallest / Balanced / Sharp (segmented control) plus a fine 1–100 slider
     showing the exact %; "Keep original copy"; "Preview each image before upload".
   - Progress list: one row per file in the current upload — thumbnail, name,
     "3.1 MB → 412 KB · −87%" when done, progress bar while converting, "Waiting…",
     or a plain reason when passed through ("Animated — uploaded as is",
     "WebP was larger — original uploaded", "Couldn't convert — original uploaded").
   - Footer summary: "✓ 3 of 5 converted · saved 4.2 MB".
5. **When the panel shows (user decision):**
   - On screens where an upload area is visible (Library, media modal,
     Add New, Elementor modal): the panel sits collapsed to just its header +
     badge in the bottom-right corner, so quality can be set *before* uploading.
   - When any upload starts anywhere (including block-editor drops): the panel
     slides in showing progress.
   - Block editor / site editor (user decision): a small "⚡ WebP · 82%" button
     in the editor's top toolbar opens the panel with settings expanded, so
     quality can be set before dropping an image onto the canvas. The badge text
     tracks the current quality (and shows "off" when conversion is disabled).
   - It auto-hides a few seconds after all uploads finish (not while settings are
     open or hovered). Nothing shows on other screens.
6. **Never break uploads:** on any conversion failure, encoder load failure, or
   if the WebP is not smaller than the original, the original uploads unchanged
   and the panel row says why.
7. **Server can't handle WebP:** if WordPress reports the server can't edit
   WebP (`plupload` setting `webp_upload_error`, i.e. no GD/Imagick WebP support),
   conversion turns itself off and the panel says so once, plainly
   ("This server can't process WebP — uploading originals"). Otherwise every
   upload would be rejected by core.
8. **Responsiveness:** converting must not freeze the page. *Builder's call:*
   decode + downscale + encode in a module Web Worker (OffscreenCanvas), with a
   small pool sized to `navigator.hardwareConcurrency` (cap ~3); fall back to
   main thread if workers/OffscreenCanvas are unavailable.

## Kept from v1 (unchanged behavior)

- Quality default 82, max edge 2460 px (downscale, aspect preserved), filters
  `ds_webp_default_quality`, `ds_webp_max_dim`, `ds_webp_keep_original`,
  `ds_webp_backup_max_bytes`.
- Keep Original vault (`uploads/ds-originals/{token}/YYYY/MM/`, `.htaccess`
  deny, `_ds_original_backup` meta, delete cleanup).
- Post meta `_ds_webp_quality`, `_ds_orig_size`; attachment-details "DS WebP"
  row; `dsWebp` on the media JS model.
- Settings persist per browser (localStorage), as today.
- mu-plugin layout: loader file in `mu-plugins/` + plugin folder beside it.
- Front end untouched; everything is limited to wp-admin and the Elementor editor.
- The fixes on branch `fix/ds-webp-intercept-order` (early hook install,
  priority-100 FilesAdded intercept, FS_CHMOD_FILE fallback) are the base.

## Non-goals

- Bulk-converting images already in the Media Library.
- Front-end uploads (forms, WooCommerce customer uploads).
- AVIF output, or a per-site settings page in wp-admin (constants + filters stay).
- Server-side conversion of any kind.

## Anti-goals (failure even if it "works")

- Any upload that fails or is lost because of the plugin.
- Duplicate attachments (raw + WebP) or stuck "uploading" tiles.
- A WebP uploaded that is larger than its original.
- The admin UI freezing during a batch.
- Visible clutter on admin screens with no upload happening.

## Constraints

- No build step; plain ES modules + vendored jSquash, served statically from
  the mu-plugin folder (Hostinger, LiteSpeed). WP 6.6+ for script modules in
  admin (6.5 doesn't print modules in wp-admin — use the classic
  `type="module"` fallback path below 6.6, not only below 6.5).
- Must keep working when WordPress's own client-side media processing
  (`window.__clientSideMediaProcessing`, WP 7.0) is on: the main file still goes
  through `POST /wp/v2/media`; conversion happens before that.
- Block-editor path via an `apiFetch` middleware that replaces the FormData
  `file` with the converted File and adds `_ds_webp_quality` / `_ds_orig_size`
  fields; PHP must read these on the REST path too
  (`rest_after_insert_attachment`), not only `add_attachment` + `$_REQUEST` from
  async-upload.php.
- Keep Original on the REST path: vault the original after the REST response
  returns the attachment id (same AJAX endpoint).
- Accessibility: panel is keyboard-operable, badge is a real button with
  `aria-expanded`, progress uses `aria-live="polite"`, respects
  `prefers-reduced-motion`, colors meet WCAG AA, matches wp-admin styling.

## Calls made by the designer (not the user — check these)

- **WP 7.0 client-side media processing:** when `window.__clientSideMediaProcessing`
  is on, core builds sub-sizes in the browser from the original File, before
  apiFetch, so swapping only the main `file` would leave JPEG/PNG sub-sizes.
  Call: while conversion is enabled, set `window.__clientSideMediaProcessing = false`
  before the editor boots (print an inline script early in `admin_head`), so the
  server builds sub-sizes from our WebP as on every other path. Revisit when the
  feature leaves experimental status.
- **Vault formats:** Keep Original vaults every converted original (JPEG, PNG,
  BMP, GIF, TIFF, HEIC). PHP whitelist grows accordingly; the `getimagesize`
  integrity check applies to the formats PHP can read and is skipped for HEIC.
- **Preview each image:** stays one modal per file, in order, on every path.
  On the REST path the apiFetch middleware simply awaits the modal (apiFetch
  has no timeout), and the block keeps its normal placeholder meanwhile.
- **Minimum WordPress:** 6.4 (media-utils → apiFetch upload path is stable
  there). Tested against 6.5 (classic-script fallback) and latest.
- **Test tooling:** Playwright via `npx` under `dev/` only (dev dependency,
  never shipped; the plugin itself stays build-free). Server-no-WebP case via a
  dev-only mu-plugin that filters `wp_image_editors` to an empty list.

## Testing

- Keep the Docker harness (WP latest + MariaDB + wp-cli, plugin bind-mounted
  as an mu-plugin) under `dev/` with a README, so any change can be re-verified.
- One runnable browser check covering: Add New, Library grid, media modal,
  block-editor drop (REST path), mixed batch with non-image + animated GIF,
  WebP-larger fallback, Keep Original vault, and server-no-WebP fallback.
  Pass criteria: only WebP attachments for convertible inputs, originals for
  the rest, no duplicates, meta present.

## Left to the builder

- Worker/pool internals, file module split (keep files small and focused).
- Exact preset values (suggest Smallest 60 / Balanced 82 / Sharp 92).
- Animated-GIF detection method (frame count via `ImageDecoder` where
  available, else parse GIF for >1 image descriptor).
- Panel animation and auto-hide timing.
- The old in-dropzone control bar is removed, replaced by the panel.
