# Dsquoosh — DS WebP Squoosh Studio

**Common repo:** [https://github.com/sidhanth-povil/Dsquoosh](https://github.com/sidhanth-povil/Dsquoosh)
(all updates go here; `main` is the release branch)

Dsquoosh is a WordPress plugin — shipped as an **mu-plugin** — that turns every
normal image uploaded anywhere in wp-admin into a WebP **in the uploader's own
browser**, with zero server load. It uses Squoosh's libwebp WASM encoder (the
engine behind [squoosh.app](https://squoosh.app/)) running in a Web Worker pool,
so the admin page stays responsive. Only the WebP is uploaded — but only when it
is actually **smaller** than the original; otherwise the untouched original is
sent, exactly as before. WordPress then builds sub-sizes from the WebP as usual.

No external services, no CDN calls, no API keys, and **no npm or build step on
your sites**: the plugin folder ships as static files.

A small floating **"WebP converter"** panel lets you set quality before
uploading and shows what happened to each file afterwards.

## Repository layout

| Path | What it is |
| ---- | ---------- |
| `ds-webp-squoosh/` | **The plugin.** This is what you copy to a WordPress site; everything in it is served statically. |
| `ds-webp-squoosh/readme.md` | Full plugin documentation (features, formats, upgrading, module map). |
| `dev/` | Dev-only test harness: Docker WordPress, node unit tests, Playwright e2e. Never ships with the plugin. |
| `docs/superpowers/specs/` | Design documents. |
| `docs/superpowers/plans/` | Implementation plans (checkbox-tracked). |

## Requirements

- WordPress **6.4+** (tested on 6.5 and the latest release).
- A modern browser: current Chromium (Chrome, Edge), Firefox or Safari.
- Any host with standard uploads handling; built with Hostinger Cloud
  (LiteSpeed/Apache) in mind.

## Install

1. Upload the **whole `ds-webp-squoosh/` folder** into
   `wp-content/mu-plugins/` (create `mu-plugins/` next to `plugins/` if it
   doesn't exist — mu-plugins need no activation). Keep
   `ds-webp-squoosh.php` and `assets/` together: the WASM files must be served
   statically beside the JS.
2. **Required:** also copy **`ds-webp-squoosh-loader.php`** (from inside that
   folder) **directly into `wp-content/mu-plugins/`, next to the folder, not
   inside it.** WordPress ignores PHP files inside mu-plugin subfolders, so
   without this loader file nothing runs.
3. **Verify:** open **Media → Add New**. A **"WebP converter"** badge appears at
   the bottom-right of the screen. If it is missing, the plugin is not loading
   yet — don't test uploads until it shows.
4. Repeat on each site.

## What to avoid

These are the failure modes that can make the plugin not run or uploads not
convert. None of them break existing uploads (conversion failures always fall
back to the original), but avoid them anyway:

- **Don't test uploads before the "WebP converter" badge is visible.** If the
  badge is missing, the plugin isn't loading and conversions won't happen.
- **Don't copy the loader file *inside* the plugin folder.** It must sit
  directly in `mu-plugins/`, one level up; WordPress never loads PHP from
  subfolders there.
- **Don't install it as a normal (non-mu) plugin and don't rename the folder.**
  The `.htaccess` shipping for cache revalidation and the vault hardening
  assume this exact static layout.
- **Don't split, rename or remove anything under `assets/`**, especially the
  `assets/vendor/@jsquash/webp/` WASM files — the encoder expects the `.wasm`
  files beside its ESM module.
- **Don't edit the JS in place and expect changes without a cache clear.**
  Apache/LiteSpeed hosts revalidate automatically via `assets/.htaccess`; on
  **nginx** hard-refresh wp-admin (Ctrl/Cmd+Shift+R) after upgrading.
- **Don't transpile or bundlify the plugin.** It is plain ES modules enqueued
  with `wp_enqueue_script_module` on WP 6.6+ (classic `type="module"` tag on
  6.4–6.5); no tooling is required — or wanted — on production sites.
- **Don't assume the vault is protected on nginx.** `uploads/ds-originals/`
  gets an `.htaccess` deny + `index.php` (Apache/LiteSpeed only). On nginx you
  must add a server-config block to deny direct access to that folder
  yourself.
- **Don't run "Keep original copy" on huge sites with no SFTP access.** Vaulted
  originals are stored under the tokenized `ds-originals/` folder and are meant
  to be retrieved manually via SFTP using the `_ds_original_backup` meta value;
  if you can't reach the filesystem, you won't reach the originals.
- **Don't bulk "convert the library" with this plugin.** It only converts
  uploads. Existing media, and front-end uploads, are non-goals (see the
  design docs).
- **Don't enable WordPress 7.0's experimental client-side media processing and
  this plugin together and expect the plugin to be bypassed:** while this
  plugin is active it switches that core feature off intentionally, so the
  server builds sub-sizes from the converted WebP. Reverting that flag
  manually would reintroduce JPEG/PNG sub-sizes from the original.
- **Developers: never ship or deploy the `dev/` folder**, and never commit
  editor/system cruft; `dev/` test state, screenshots and chat scratch files
  are ignored or kept out of `main` on purpose.

## Where it works

- **Media → Add New** (`media-new.php`).
- **Media Library** grid (`upload.php`): drag and drop or Select Files.
- **Any media popup**: post editor "Add media", featured image, Elementor.
- **Block editor and site editor**: dropping images onto the canvas and Image /
  Gallery / Cover block upload buttons (via a `POST /wp/v2/media` middleware).
- The front end is untouched; nothing is added to other admin screens.

## What gets converted

| Input | Result |
| ----- | ------ |
| JPEG, PNG, BMP | Converted to WebP |
| Static (single-frame) GIF | Converted to WebP |
| HEIC, TIFF and other rasters | Converted where the browser can decode them (Safari); otherwise uploaded as is |
| Animated GIF | Kept as is (animation would be lost) |
| WebP, AVIF, SVG | Uploaded as is (already web formats) |
| PDFs, video, audio, other non-images | Uploaded as is |

Images wider or taller than the max edge (**2460 px**) are downscaled with the
aspect ratio preserved. A WebP that would be **larger** than the original is
never uploaded — the original goes instead, and the panel says why.

## The WebP converter panel

- On upload screens it sits collapsed bottom-right as a **"⚡ 82% ▾"** badge, so
  quality can be set *before* uploading (bottom-left inside a media popup so it
  never covers the attachment-details sidebar).
- In the block/site editor a **"⚡ WebP · 82%"** toolbar button opens it with
  settings expanded.
- Settings: convert on/off, presets **Smallest (60) / Balanced (82, default) /
  Sharp (92)**, a 1–100 slider, **Keep original copy**, and **Preview each
  image before upload** (side-by-side original vs WebP with a live slider).
  Settings persist per browser (localStorage).
- Progress rows show `3.1 MB → 412 KB · −87%`, or the reason a file was left
  alone ("Animated — uploaded as is", "WebP was larger — original uploaded",
  "Couldn't convert — original uploaded", "Uploaded as is"), with a footer
  summary like "✓ 3 of 5 converted · saved 4.2 MB".
- It auto-hides ~4 s after uploads finish (unless hovered/focused/open), is
  keyboard accessible (`aria-expanded`, `aria-live`) and respects
  reduced-motion.
- A read-only **DS WebP** row in the attachment-details sidebar shows original →
  WebP size, saving %, quality used, and whether the original was vaulted; other
  attachments get no row. Admin JS can read the same data as
  `attachment.get('dsWebp')` = `{ origSize, quality, vaulted }`.

**Uploads never break:** on any conversion failure, encoder load failure,
undecodable file, or a "not smaller" result, the original uploads unchanged.
If the server cannot process WebP (no GD/Imagick WebP support) the panel shows
"This server can't process WebP — uploading originals" and conversion disables
itself, because core would otherwise reject every WebP upload.

## Keep original copy

With "Keep original copy" on, the untouched original (JPEG, PNG, BMP, GIF,
TIFF, HEIC; up to 20 MB per file) is vaulted to
`wp-content/uploads/ds-originals/{random-token}/YYYY/MM/` and linked to the
attachment with `_ds_original_backup` post meta. Vault files are deleted when
the attachment is deleted. The vault folder is hardened with `.htaccess` deny +
`index.php` on Apache/LiteSpeed; **on nginx protect it in your server config**.
One backup per attachment (re-uploading the same attachment again won't
overwrite it).

## Options (filters)

Defaults are constants at the top of `ds-webp-squoosh.php`; override with
filters — no database options:

| Filter | Default | Meaning |
| ------ | ------- | ------- |
| `ds_webp_default_quality` | `82` | Initial quality (1–100) before a person changes it |
| `ds_webp_max_dim` | `2460` | Longest edge in px; larger images are downscaled |
| `ds_webp_keep_original` | `false` | Initial state of "Keep original copy" |
| `ds_webp_backup_max_bytes` | `20971520` (20 MB) | Largest original the vault accepts |

Post meta written per converted attachment: `_ds_webp_quality`,
`_ds_orig_size`, and `_ds_original_backup` (vault path, only when a copy was
kept). One site option exists: `ds_webp_vault_token` (the random vault folder
token).

## Troubleshooting

- **Badge missing on Media → Add New** → the plugin isn't loading: check that
  the loader file is in `mu-plugins/` (step 2) and the folder is complete.
- **Files upload but stay JPEG/PNG** → check the panel banner: a server
  without WebP support disables conversion on purpose.
- **File uploads but no WebP after upgrade (nginx)** → hard-refresh wp-admin;
  nginx ignores the shipped `.htaccess` cache rules.
- **Settings lost between browsers** → expected: settings live in each
  browser's localStorage, not in the database.
- **Uninstall:** delete both the folder and the loader file. Vaulted originals
  stay on disk by design; remove `uploads/ds-originals/` manually when you no
  longer need them.

## Development & testing

The `dev/` folder holds a self-contained test harness (WordPress + MariaDB +
wp-cli via Docker, `node --test` unit tests, Playwright e2e). It never ships
with the plugin. See [`dev/README.md`](dev/README.md) for the full commands:

```bash
bash dev/setup.sh                 # WordPress at http://localhost:8089 (admin/admin)
npm --prefix dev i && npx --prefix dev playwright install chromium   # once
npm --prefix dev run unit         # node unit tests
npm --prefix dev run e2e          # full Playwright suite (subset with: npm --prefix dev run e2e -- smoke)
```

Project docs — design, plan and project brief — live under `docs/`. See
[`docs/PROJECT.md`](docs/PROJECT.md) for the full map.

## Version & license

Current version **1.2.0**, licensed **GPL-2.0-or-later**. Published as a
WordPress mu-plugin by DesignSuite Studio.
