# DS WebP Squoosh Studio — v1.2.1

Every normal image uploaded in wp-admin becomes a WebP **in the uploader's
browser**, with **zero server load**. Conversion uses Squoosh's own libwebp WASM
encoder (the engine behind [squoosh.app](https://squoosh.app/)) running in a Web
Worker pool, so the page stays responsive. Only the WebP is uploaded; WordPress
then builds sub-sizes from it as usual. No external services, no CDN calls, no
API keys, no npm or build step on your sites.

A small floating **"WebP converter"** panel lets you pick the quality before you
upload and shows what happened to each file afterwards.

## Requirements

- WordPress **6.4+** (tested on 6.5 and the latest release).
- A modern browser: current Chromium (Chrome, Edge), Firefox or Safari.
- Works on any host with standard uploads handling; built with Hostinger Cloud
  (LiteSpeed/Apache) in mind.

## Install

1. Download **[`ds-webp-squoosh.zip`](https://github.com/sidhanth-povil/Dsquoosh/releases/latest/download/ds-webp-squoosh.zip)**
   from the latest release.
2. **Plugins → Add New → Upload Plugin**, choose the zip, **Install Now**, then
   **Activate**.
3. **Verify:** open **Media → Add New**. A **"WebP converter"** badge appears at
   the bottom-right of the screen. If it is missing the plugin is not loading
   yet; don't test uploads until it shows.

Repeat on each site. That's the last manual step: from then on new versions
install themselves.

### Automatic updates

- Each site asks GitHub for the latest release during WordPress's normal update
  check (about every 12 hours; the answer is cached for 6) and installs a newer
  version in the background. Auto-updates are always on for this plugin.
- To pick up a release right away: **Dashboard → Updates → Check again**, then
  update.
- The site must reach `api.github.com` and `github.com`. With
  `AUTOMATIC_UPDATER_DISABLED` the update still shows on **Plugins**, ready for
  one click; `DISALLOW_FILE_MODS` blocks plugin updates entirely.
- Keep the folder name `ds-webp-squoosh/`: updates install into that folder.

### Moving from the mu-plugin install (1.2.0 and older)

mu-plugins never receive updates, so switch each site once:

1. Install and activate the zip as above. While the mu-plugin copy is still
   there it keeps running and the new copy stays idle, so nothing breaks.
2. Delete `wp-content/mu-plugins/ds-webp-squoosh-loader.php` and the
   `wp-content/mu-plugins/ds-webp-squoosh/` folder.
3. Purge caches, hard-refresh wp-admin and check the badge.

Settings (browser storage), conversion data and vaulted originals are kept.
The mu-plugin layout (folder plus `ds-webp-squoosh-loader.php` in
`mu-plugins/`) still works, but it never updates automatically.

### After any upgrade

- Settings are kept: they live in each person's browser storage.
- **LiteSpeed / Apache (Hostinger):** `assets/.htaccess` makes browsers
  revalidate JS and WASM, so the new version is picked up automatically.
- **nginx hosts** ignore `.htaccess`: hard-refresh wp-admin (Ctrl/Cmd+Shift+R)
  once after upgrading.
- The vault's `.htaccess` deny (see Keep original copy) also does not apply on
  nginx. Protect `wp-content/uploads/ds-originals/` in your server config.

## Where it works

- **Media → Add New** (`media-new.php`).
- **Media Library** grid (`upload.php`): drag and drop or Select Files.
- **Any media popup**: post editor "Add media", featured image, and Elementor's
  media popup.
- **Block editor and site editor**: dropping images onto the canvas and the
  Image/Gallery/Cover block upload buttons.

The front end is untouched. Nothing is added to other admin screens.

## What gets converted

| Input | Result |
| ----- | ------ |
| JPEG, PNG, BMP | Converted to WebP |
| Static (single-frame) GIF | Converted to WebP |
| HEIC, TIFF and other rasters | Converted only where the browser can decode them (Safari); otherwise uploaded as is |
| Animated GIF | Kept as is (animation would be lost) |
| WebP, AVIF, SVG | Uploaded as is (already web formats) |
| PDFs, video, audio, other non-images | Uploaded as is |

Images wider or taller than the max edge (**2460 px**) are downscaled with the
aspect ratio preserved.

## The WebP converter panel

- **On upload screens** (Add New, Library, media popups) the panel sits
  collapsed in the bottom-right corner as a header with a **"⚡ 82% ▾"** badge,
  so you can set quality *before* uploading. Inside a media popup it moves to the
  bottom-left so it never covers the attachment-details sidebar.
- **In the block editor and site editor** there is a **"⚡ WebP · 82%"** button
  in the top toolbar. It opens the panel with settings expanded. The button shows
  "off" when conversion is disabled.
- Click the badge (or press Enter) to expand or collapse settings; Esc collapses.
- **Settings**
  - **Convert uploads to WebP**: on/off switch.
  - **Presets**: Smallest (60), Balanced (82, default), Sharp (92).
  - **Slider**: any quality from 1 to 100; the exact value is shown.
  - **Keep original copy**: also stores the untouched original (see below).
  - **Preview each image before upload**: one modal per file shows original vs
    WebP side by side with a live quality slider and the saving.
  - Settings persist per browser.
- **Progress**: one row per file with a thumbnail, name, and a progress bar
  while converting, then `3.1 MB → 412 KB · −87%`. Files not converted say why:
  "Animated — uploaded as is", "WebP was larger — original uploaded", "Couldn't
  convert — original uploaded", "Uploaded as is". A footer summarises, e.g.
  "✓ 3 of 5 converted · saved 4.2 MB".
- **Auto-hide**: about 4 seconds after all uploads finish the list clears and the
  panel hides (unless you are hovering it, focused in it, or settings are open).
  On upload screens the collapsed header stays.
- Keyboard accessible (real buttons, `aria-expanded`, live region for progress)
  and respects reduced-motion.

## Safety: uploads never break

The **original uploads unchanged** whenever:

- conversion fails or the encoder cannot load;
- the browser cannot decode the file;
- the **WebP is not smaller** than the original;
- the server cannot process WebP (no GD/Imagick WebP support). The panel shows
  a banner, "This server can't process WebP — uploading originals", and the
  switch is disabled, because core would otherwise reject every WebP upload.

## WordPress 7.0 client-side media processing

WordPress 7.0's experimental client-side media processing is **switched off
while this plugin is active** (`window.__clientSideMediaProcessing = false`,
printed early in wp-admin and in the Elementor editor). Otherwise core would
build sub-sizes in the browser from the original JPEG/PNG. With it off, the
server builds sub-sizes from the converted WebP, as on every other path.

## Keep original copy

With **Keep original copy** on, the untouched original (JPEG, PNG, BMP, GIF,
TIFF, HEIC; up to 20 MB) is vaulted to
`wp-content/uploads/ds-originals/{random-token}/YYYY/MM/` and linked to the
attachment with `_ds_original_backup` post meta. Vault files are deleted when the
attachment is deleted. The vault folder gets an `.htaccess` deny and an
`index.php`; on nginx protect it in the server config. To fetch an original, use
SFTP with the path stored in that post meta.

## Attachment details panel

In the media popup sidebar ("Attachment Details") and on the edit-attachment
screen, every attachment converted by this plugin shows a read-only **DS WebP**
row: original size → WebP size with the saving %, the quality used, and
"Original vaulted: Yes" when a copy was kept. Other attachments get no row. The
same data is available to admin JS as `attachment.get( 'dsWebp' )` =
`{ origSize, quality, vaulted }`.

## Configuration

Defaults are constants at the top of `ds-webp-squoosh.php`; override them with
filters (no database options):

| Filter | Default | Meaning |
| ------ | ------- | ------- |
| `ds_webp_default_quality` | `82` | Initial quality (1–100) before a person changes it |
| `ds_webp_max_dim` | `2460` | Longest edge in px; larger images are downscaled |
| `ds_webp_keep_original` | `false` | Initial state of "Keep original copy" |
| `ds_webp_backup_max_bytes` | `20971520` (20 MB) | Largest original the vault accepts |

Post meta written per converted attachment: `_ds_webp_quality`, `_ds_orig_size`,
and `_ds_original_backup` (vault path, only when a copy was kept).

## Uninstall

Deactivate and delete the plugin on **Plugins** (mu-plugin installs: delete the
`ds-webp-squoosh/` folder and `ds-webp-squoosh-loader.php`). Vaulted originals stay on disk by design; remove
`uploads/ds-originals/` manually when you no longer need them.

## Developer notes

- **Test harness:** `dev/` holds a Docker WordPress, node unit tests and
  Playwright e2e tests. It is dev-only and never ships. See
  [`dev/README.md`](../dev/README.md).
- **Module map** (`assets/studio.js` is the entry ES module, no bundler):

  | Module (`assets/lib/`) | Role |
  | ---------------------- | ---- |
  | `settings.js` | Settings store, presets, localStorage persistence |
  | `classify.js` | Decide convert / pass through (animated GIF detection, web formats, decodability) |
  | `pipeline.js` | Per-file flow: classify, convert, size check, fall back to original |
  | `convert.js`, `convert-worker.js` | Worker pool (OffscreenCanvas + libwebp), main-thread fallback |
  | `plupload-adapter.js` | Hooks core's plupload uploaders (Add New, Library, media popups) |
  | `rest-adapter.js` | `apiFetch` middleware for block/site editor uploads (`POST /wp/v2/media`) |
  | `vault.js` | Sends the original to the vault AJAX endpoint |
  | `jobs.js` | Observable list of per-file jobs |
  | `panel.js`, `panel-rows.js`, `panel-settings.js` | Floating panel, progress rows and strings, settings form; editor toolbar button |
  | `preview-modal.js` | "Preview each image" modal |

- `assets/vendor/@jsquash/webp/` is the Apache-2.0 jSquash repackaging of
  Squoosh's libwebp codecs (v1.5.0, `wasm-feature-detect` vendored as
  `feature-detect.js`). It is ESM-only and expects the `.wasm` files beside the
  JS, which is why the whole folder ships together and is served statically.
- `studio.js` is enqueued with `wp_enqueue_script_module` on WP 6.6+ and as a
  `type="module"` script tag on older cores (6.4–6.5).
