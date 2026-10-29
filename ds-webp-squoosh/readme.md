# DS WebP Squoosh Studio

In-dashboard WebP conversion for WordPress **with zero server load**. When any
team member adds a JPEG or PNG to the Media Library (media modal, Gutenberg,
Elementor, `media-new.php`), the plugin converts it to WebP **in that user's
browser** using Squoosh's own libwebp WASM encoder — the exact engine behind
[squoosh.app](https://squoosh.app/), so quality matches your current manual
workflow. Only the WebP file is uploaded; WordPress then serves WebP natively.

Built for Hostinger Cloud (LiteSpeed/Apache `.htaccess` honored) — works on any
host with standard uploads handling. No external services, no CDN calls, no
API keys, no npm step on your sites.

## Behavior

| Setting            | Default     | Where to change |
| ------------------ | ----------- | --------------- |
| Quality            | **82%**     | Slider on the upload bar (persists per browser) |
| Max edge           | **2460px**  | `DS_WebP_Squoosh_Studio::MAX_DIM` in the PHP |
| Keep Original      | **OFF**     | Per-upload toggle (persists per browser) |
| Preview modal      | OFF         | "Preview" toggle on the upload bar |

- SVG, GIF, WebP, PDF etc. pass through untouched; only `.jpg/.jpeg/.png` are converted.
- Images longer than the max edge on the longest side are downscaled with aspect ratio preserved.
- If conversion fails for any reason, the **original uploads unchanged** — uploads never break.
- With "Keep Original" on, the untouched file is vaulted to
  `uploads/ds-originals/{random-token}/YYYY/MM/` and linked to the attachment via
  `_ds_original_backup` postmeta. Each converted attachment records `_ds_webp_quality`
  and `_ds_orig_size`. Vault files are deleted automatically when the attachment is deleted.
- Front-end markup, cache behavior and page speed are untouched — every change
  is limited to `/wp-admin/` and the Elementor editor.

## Attachment details panel

In the media modal sidebar ("Attachment Details") and on the edit-attachment
page, every attachment converted by this plugin shows a read-only
**DS WebP** row: original size → WebP size with the savings %, the quality
used, and "Original vaulted: Yes" when Keep Original was on. Unprocessed
attachments get no row at all — nothing collapses, nothing is editable. The
same metrics are exposed to the media model (`wp_prepare_attachment_for_js`)
as `attachment.get( 'dsWebp' )` = `{ origSize, quality, vaulted }` for any
future admin JS. The "re-Squoosh in place" button stays a v2 idea.

## Install on a Hostinger site

1. In this folder, upload the **whole `ds-webp-squoosh/` directory** — the PHP
   file and its `assets/` subfolder must stay together — into
   `wp-content/mu-plugins/`. Create `mu-plugins/` next to `plugins/` if it
   doesn't exist (mu-plugins auto-loads with no activation step).
   
   FileZilla path: `public_html/wp-content/mu-plugins/ds-webp-squoosh/`
   
2. Verify: open wp-admin → Media Library → Add New. A blue **"DS WebP"** bar
   with sliders and checkboxes appears above the dropzone. Drop a JPEG — the
   queue shows a `.webp` entry and uploads it.

That's it. Repeat the upload step on each of your sites.

## Admin notes

- The preview ("Inspect") modal shows original vs WebP side by side, the live
  quality slider updates the WebP size encode as you move it, and shows the
  savings percentage before upload.
- Settings can be tuned server-side by editing the constants block at the top
  of `ds-webp-squoosh.php` (no DB options needed) or via these filters:
  `ds_webp_default_quality`, `ds_webp_max_dim`, `ds_webp_keep_original`,
  `ds_webp_backup_max_bytes`.
- To *load* a vaulted original later (for a future "re-Squoosh" step), grab it
  with SFTP from the vault path shown in the attachment's postmeta; the vault
  is directly blocked by `.htaccess` for security.
- Upgrading/uninstalling: replace the folder (update) or delete it; vaulted
  originals remain on disk (they are your backups by design) but lose admin
  visibility — remove `uploads/ds-originals/` manually once you're done.

## Developer notes

- `assets/vendor/@jsquash/webp/` is the Apache-2.0-licensed jSquash
  repackaging of Squoosh's libwebp codecs (with `wasm-feature-detect`
  vendored to `feature-detect.js`). Version 1.5.0. It is ESM-only and expects
  the `.wasm` files to sit beside the JS — which is why the whole folder ships
  together and must be served statically (WebAssembly streaming, no bundler).
- the WP-side glue (`studio.js`) is a plain ES module enqueued with
  `wp_enqueue_script_module` on WP 6.5+ or a `type="module"` script tag on
  older cores; `media editor` dependencies keep it after Plupload/media code.
