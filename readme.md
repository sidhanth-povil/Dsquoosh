<div align="center">

# ⚡ Dsquoosh — DS WebP Squoosh Studio

**Every image uploaded in wp-admin becomes a WebP — in the uploader's browser, with zero server load.**

Powered by Squoosh's own libwebp WASM encoder (the engine behind
[squoosh.app](https://squoosh.app/)) running in a Web Worker pool.
Only the WebP is uploaded — and only when it's actually smaller.

[![Release](https://img.shields.io/github/v/release/sidhanth-povil/Dsquoosh?label=release&color=2271b1)](https://github.com/sidhanth-povil/Dsquoosh/releases/latest)
[![WordPress](https://img.shields.io/badge/WordPress-6.4%2B-21759B?logo=wordpress&logoColor=white)](https://wordpress.org)
[![License](https://img.shields.io/badge/License-GPL--2.0--or--later-00a32a)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![Build-free](https://img.shields.io/badge/site%20build%20step-none-orange)](./ds-webp-squoosh)
[![Install](https://img.shields.io/badge/install-zip%20%C2%B7%20auto--updates-8e44ad)](#-install)
[![Tests](https://img.shields.io/badge/tests-node%20%2B%20Playwright-2271b1)](#-development--testing)

**[⬇️ Download the latest `ds-webp-squoosh.zip`](https://github.com/sidhanth-povil/Dsquoosh/releases/latest/download/ds-webp-squoosh.zip)**

</div>

---

> [!TIP]
> **Try it in 30 seconds:** upload [`ds-webp-squoosh.zip`](https://github.com/sidhanth-povil/Dsquoosh/releases/latest/download/ds-webp-squoosh.zip) under **Plugins → Add New → Upload Plugin**, activate, open
> **Media → Add New**, look for the **"WebP converter" ⚡ badge** in the
> bottom-right corner. That badge is your confirmation the plugin is live.

## 📖 Table of contents

- [Why this exists](#-why-this-exists)
- [Repository layout](#-repository-layout)
- [Install](#-install)
- [Automatic updates](#-automatic-updates)
- [What to avoid](#-what-to-avoid)
- [Where it works](#-where-it-works)
- [What gets converted](#-what-gets-converted)
- [The WebP converter panel](#-the-webp-converter-panel)
- [Safety: uploads never break](#-safety-uploads-never-break)
- [Keep original copy](#-keep-original-copy)
- [Options (filters)](#-options-filters)
- [Troubleshooting](#-troubleshooting)
- [Development & testing](#-development--testing)
- [Changelog](#-changelog)
- [Version & license](#-version--license)

## 💡 Why this exists

WordPress sites host gigabytes of JPEG/PNG that could be **30–80% smaller** as
WebP — but traditional converters move the CPU cost onto the server, or push
your media through a third-party CDN or API. Dsquoosh does neither:

| | Traditional server-side converter | Dsquoosh |
| --- | --- | --- |
| Where conversion happens | On your PHP worker | In the uploader's **browser tab** |
| Server CPU cost | Per upload | **Zero** |
| External services / API keys | Often | **None** |
| Setup on end machines | — | **Nothing** (no npm, no build) |
| uploads break on failure | Maybe | **Never** (original falls back) |

The WebP is uploaded first; WordPress then builds sub-sizes from it as usual.

## 🧾 Repository layout

| Path | What it is |
| ---- | ---------- |
| [`ds-webp-squoosh/`](./ds-webp-squoosh) | **The plugin.** Ships as `ds-webp-squoosh.zip` on each release; served statically. |
| [`ds-webp-squoosh/updater.php`](./ds-webp-squoosh/updater.php) | Self-updater: offers new GitHub releases to WordPress and keeps auto-updates on. |
| [`ds-webp-squoosh/readme.md`](./ds-webp-squoosh/readme.md) | Full plugin documentation (features, formats, upgrading, module map). |
| [`dev/`](./dev) | Dev-only test harness: Docker WordPress, unit tests, Playwright e2e. Never ships. |
| [`docs/`](./docs) | Design docs, implementation plans and the [project brief](./docs/PROJECT.md). |
| [`.github/workflows/release.yml`](./.github/workflows/release.yml) | Builds and attaches `ds-webp-squoosh.zip` to every published release. |
| [`SECURITY.md`](./SECURITY.md) | How to report a vulnerability privately, and how releases are protected. |

**Requirements:** WordPress **6.4+** (tested on 6.5 and latest) · current
Chromium, Firefox or Safari · any host with standard uploads handling (built
with Hostinger Cloud / LiteSpeed / Apache in mind).

## 🚀 Install

1. Download **[`ds-webp-squoosh.zip`](https://github.com/sidhanth-povil/Dsquoosh/releases/latest/download/ds-webp-squoosh.zip)** from the latest release.
2. **Plugins → Add New → Upload Plugin**, choose the zip, **Install Now**, **Activate**.
3. **Verify:** open **Media → Add New** and confirm the ⚡ badge from the callout above appears.

Repeat on each site, **once**. After that every site updates itself (see
[Automatic updates](#-automatic-updates)).

> [!NOTE]
> **Sites on the old mu-plugin install (1.2.0)** never receive updates. Install
> the zip as above, then delete `mu-plugins/ds-webp-squoosh-loader.php` and
> `mu-plugins/ds-webp-squoosh/`. Running both at once is safe: the mu copy wins
> and the plugin copy stays idle. Details in the
> [plugin readme](./ds-webp-squoosh/readme.md#moving-from-the-mu-plugin-install-120-and-older).

> [!IMPORTANT]
> If the badge is missing, the plugin is not loading — **don't test uploads
> until it shows.**

## 🔄 Automatic updates

Since **v1.2.1** the plugin updates itself from this repo's GitHub releases. No
manual uploads, no third-party updater service.

| | |
| --- | --- |
| **How** | Each site asks GitHub for the latest release during WordPress's normal update check and installs a newer version in the background. |
| **When** | Within about 12 hours of a release (answers are cached for 6 h). **Dashboard → Updates → Check again** pulls it right away. |
| **Switch** | Auto-updates are always on for this plugin; the **Plugins** screen shows them as enabled. |
| **Needs** | Outbound access to `github.com` and `api.github.com`. With `AUTOMATIC_UPDATER_DISABLED` the update still shows on **Plugins** for one click; `DISALLOW_FILE_MODS` blocks plugin updates entirely. |
| **Follows** | Only the **latest full release**. Pre-releases are ignored, which makes them handy for testing on one site first. |

Shipping a release is a version bump plus `gh release create` (see
[Releasing a new version](#-development--testing)).

## ⚠️&nbsp; What to avoid

None of these break existing uploads (conversion failures always fall back to
the original), but avoid them anyway:

| ❌ Avoid | Why |
| ------- | --- |
| Testing uploads before the **"WebP converter" badge** is visible | The badge is the plugin's only "I'm alive" signal; without it, no conversion happens. |
| Staying on the **mu-plugin** install | WordPress never update-checks mu-plugins, so those sites stay on 1.2.0 forever. |
| Renaming the `ds-webp-squoosh/` folder | Updates install into `ds-webp-squoosh/`; a renamed copy would end up as a second plugin. |
| Splitting, renaming or removing anything under **`assets/`** | The encoder expects the `@jsquash` `.wasm` files beside its ESM module. |
| Expecting changes without a cache clear after an upgrade | Apache/LiteSpeed hosts revalidate automatically via `assets/.htaccess`; on **nginx** hard-refresh wp-admin (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>). |
| Transpiling or bundling the plugin | Plain ES modules enqueued via `wp_enqueue_script_module` (WP 6.6+) with a `type="module"` fallback (6.4–6.5). No tooling wanted on production sites. |
| Assuming the vault is protected on nginx | `uploads/ds-originals/` gets an `.htaccess` deny + `index.php` (Apache/LiteSpeed only). On nginx, add the deny rule to your server config yourself. |
| Using "Keep original copy" without filesystem access | Vaulted originals are retrieved via SFTP using the `_ds_original_backup` meta path — no access, no originals. |
| Expecting this plugin to **bulk-convert the Media Library** | It converts **uploads only**. Existing media and front-end uploads are non-goals. |
| Running WordPress 7.0's experimental client-side media processing alongside it | While this plugin is active, it switches that core feature off intentionally so the server builds sub-sizes from the converted WebP. |
| Deploying the **`dev/` folder** (developers) | It's a test harness with Docker files and auth state — dev-only, never ships. |

## 🗺️ Where it works

| Screen | How images are picked up |
| ------ | ------------------------ |
| **Media → Add New** (`media-new.php`) | Standalone plupload, drag-and-drop or Select Files |
| **Media Library grid** (`upload.php`) | Drag-and-drop / Select Files (uploader built at DOM-ready) |
| **Any media popup** | Post editor "Add media", featured image, Elementor's modal |
| **Block / site editor** | Drop onto the canvas and Image / Gallery / Cover upload buttons — via a `POST /wp/v2/media` middleware |

The front end is untouched; nothing is added to other admin screens.

## 🔄 What gets converted

| Input | Result |
| ----- | ------ |
| 🖼️ JPEG, PNG, BMP | Converted to WebP |
| 🖼️ Static (single-frame) GIF | Converted to WebP |
| 🍎 HEIC, TIFF and other rasters | Converted where the browser can decode them (Safari); otherwise uploaded as is |
| 🎞️ Animated GIF | Kept as is (animation would be lost) |
| 🕸️ WebP, AVIF, SVG | Uploaded as is (already web formats) |
| 📄 PDFs, video, audio, other non-images | Uploaded as is |

Images wider or taller than the max edge (**2460 px**) are downscaled with the
aspect ratio preserved. A WebP that would be **larger** than the original is
never uploaded — the original goes instead, and the panel says why.

## 🎛️ The WebP converter panel

- On upload screens it sits collapsed bottom-right as a **`⚡ 82% ▾`** badge, so
  quality can be set *before* uploading (bottom-left inside a media popup so it
  never covers the attachment-details sidebar).
- In the block/site editor a **`⚡ WebP · 82%`** toolbar button opens it with
  settings expanded.
- Settings: convert on/off, presets **Smallest (60) / Balanced (82, default) /
  Sharp (92)**, a 1–100 slider, **Keep original copy**, and **Preview each
  image before upload** (side-by-side original vs WebP with a live slider).
  Settings persist per browser (localStorage).
- Progress rows show `3.1 MB → 412 KB · −87%`, or the reason a file was left
  alone ("Animated — uploaded as is", "WebP was larger — original uploaded",
  "Couldn't convert — original uploaded", "Uploaded as is"). A footer
  summarises, e.g. **"✓ 3 of 5 converted · saved 4.2 MB"**.
- It auto-hides ~4 s after uploads finish (unless hovered/focused/open), is
  keyboard accessible (`aria-expanded`, `aria-live`) and respects
  reduced-motion.
- A read-only **DS WebP** row in the attachment-details sidebar shows original →
  WebP size, saving %, quality used, and whether the original was vaulted; other
  attachments get no row. Admin JS can read the same data as
  `attachment.get('dsWebp')` = `{ origSize, quality, vaulted }`.

## 🛟 Safety: uploads never break

> [!NOTE]
> The **original uploads unchanged** whenever:
>
> - conversion fails or the encoder cannot load;
> - the browser cannot decode the file;
> - the **WebP is not smaller** than the original;
> - the server cannot process WebP (no GD/Imagick WebP support) — the panel
>   shows *"This server can't process WebP — uploading originals"* and
>   conversion disables itself, because core would otherwise reject every
>   WebP upload.

## 💾 Keep original copy

With **Keep original copy** on, the untouched original (JPEG, PNG, BMP, GIF,
TIFF, HEIC; up to 20 MB per file) is vaulted to
`wp-content/uploads/ds-originals/{random-token}/YYYY/MM/` and linked to the
attachment with `_ds_original_backup` post meta. Vault files are deleted when
the attachment is deleted. The vault folder is hardened with `.htaccess` deny +
`index.php` on Apache/LiteSpeed; **on nginx add this to the `server` block**:

```nginx
location ^~ /wp-content/uploads/ds-originals/ { deny all; return 403; }
```

One backup per attachment (re-uploading the same attachment again won't
overwrite it).

## 🔧 Options (filters)

Defaults are constants at the top of
[`ds-webp-squoosh.php`](./ds-webp-squoosh/ds-webp-squoosh.php); override with
filters — **no database options**:

```php
// WP 6.4+: functions.php, mu-loader, or a small plugin.
add_filter( 'ds_webp_default_quality', fn() => 70 );
add_filter( 'ds_webp_max_dim',         fn() => 1920 );
add_filter( 'ds_webp_keep_original',   fn() => true );
add_filter( 'ds_webp_backup_max_bytes', fn() => 20 * 1024 * 1024 );
```

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

## 🩺 Troubleshooting

<details>
<summary><b>Badge missing on Media → Add New</b></summary>
<br>

The plugin isn't loading: check it is **active** on **Plugins** (mu-plugin
installs: the loader file must sit directly in `mu-plugins/`). Don't test
uploads until the badge shows.

</details>

<details>
<summary><b>Files upload but stay JPEG/PNG</b></summary>
<br>

Check the panel banner — a server without WebP support disables conversion on
purpose (see [Safety](#-safety-uploads-never-break)).

</details>

<details>
<summary><b>File uploads but no WebP after an upgrade (nginx)</b></summary>
<br>

Hard-refresh wp-admin (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>);
nginx ignores the shipped `.htaccess` cache rules.

</details>

<details>
<summary><b>Settings lost between browsers</b></summary>
<br>

Expected: settings live in each browser's localStorage, not the database.

</details>

<details>
<summary><b>Uninstall</b></summary>
<br>

Deactivate and delete it on **Plugins** (mu-plugin installs: delete the folder
and the loader file). Vaulted originals stay on disk by
design; remove `uploads/ds-originals/` manually when you no longer need them.

</details>

## 🧪 Development & testing

The [`dev/`](./dev) folder holds a self-contained test harness (WordPress +
MariaDB + wp-cli via Docker, `node --test` unit tests, Playwright e2e). It
never ships with the plugin. See [`dev/README.md`](./dev/README.md).

<details>
<summary><b>Test commands</b></summary>
<br>

```bash
bash dev/setup.sh                 # WordPress at http://localhost:8089 (admin/admin)
npm --prefix dev i && npx --prefix dev playwright install chromium   # once
npm --prefix dev run unit         # node unit tests
npm --prefix dev run e2e          # full Playwright suite (subset with: npm --prefix dev run e2e -- smoke)
```

</details>

<details>
<summary><b>Releasing a new version (ships to every site)</b></summary>
<br>

1. Bump `Version:` in the header **and** `const VERSION` in
   [`ds-webp-squoosh.php`](./ds-webp-squoosh/ds-webp-squoosh.php) on a branch,
   open a PR and merge it (`main` only accepts pull requests).
2. Publish a GitHub release tagged `vX.Y.Z` (same number) from `main`. Only
   repo admins can create `v*` tags.
   `gh release create v1.3.0 --target main --title "…" --notes "…"`
3. The [`Release zip`](./.github/workflows/release.yml) workflow checks that the
   tag matches both version strings and attaches `ds-webp-squoosh.zip`. If they
   don't match it fails and no site updates.
4. Sites install it on their next update check (within about 12 hours).

Want to try a build on one site first? Mark the release as a **pre-release**:
sites only follow the latest full release. Install the zip by hand on the test
site, then promote the release to "latest" when you're happy.

</details>

See [`docs/PROJECT.md`](./docs/PROJECT.md) for the full docs map.

## 📝 Changelog

**[v1.2.2](https://github.com/sidhanth-povil/Dsquoosh/releases/tag/v1.2.2): security hardening**
- Keep original: `.heic`/`.heif` files must carry a real HEIF signature; other bytes renamed to those extensions are refused.
- Keep original: every file is validated **before** it reaches the vault folder, not after.
- Conversion metadata is only recorded for users who can upload in wp-admin, not for front-end uploads from other plugins.
- Docs: copy-paste nginx rule to protect the vault. Release workflow pinned to a commit.

**[v1.2.1](https://github.com/sidhanth-povil/Dsquoosh/releases/tag/v1.2.1): automatic updates**
- Installs as a regular plugin (`ds-webp-squoosh.zip`) and updates itself from GitHub releases.
- Safe to install next to the old mu-plugin copy while migrating; delete the mu files afterwards.
- No changes to conversion behaviour.

**[v1.2.0](https://github.com/sidhanth-povil/Dsquoosh/releases/tag/v1.2.0): WebP everywhere** (mu-plugin)
- Converts in Media → Add New, the Library grid, media popups, Elementor's media popup and block/site editor drops.
- Floating panel with presets, quality slider, Keep original, per-image preview and per-file progress.
- Concurrency limit, per-attachment checks on the vault endpoint, accessibility pass.

All releases: [github.com/sidhanth-povil/Dsquoosh/releases](https://github.com/sidhanth-povil/Dsquoosh/releases)

> [!CAUTION]
> Found a security issue? Please report it privately, not as a public issue.
> See [`SECURITY.md`](./SECURITY.md).

## 📌 Version & license

<div align="center">

**v1.2.2** · GPL-2.0-or-later · WordPress plugin by DesignSuite Studio
<br><a href="https://github.com/sidhanth-povil/Dsquoosh"><strong>github.com/sidhanth-povil/Dsquoosh</strong></a> — all updates land here

</div>
