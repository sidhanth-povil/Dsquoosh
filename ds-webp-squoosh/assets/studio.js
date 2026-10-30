/**
 * DS WebP Squoosh Studio — client-side WebP converter for the WP admin.
 *
 * Intercepts JPEG/PNG files added to any wp.Uploader queue (media modal,
 * Gutenberg, Elementor, media-new.php), encodes them to WebP with Squoosh's
 * libwebp WASM encoder (vendored ./vendor/@jsquash/webp), and uploads only the
 * WebP. Uploaded originals may optionally go to a server-side vault. Every
 * per-image conversion here runs in the administrator's browser; the server
 * does no image processing.
 *
 * If anything fails, the untouched original uploads unchanged — uploads never
 * break because of this plugin.
 */
(function dsWebpStudio() {
	'use strict';

	const config = window.DSWebPConfig || {};
	const LOCK_KEY = 'dsWebpSettings';

	const state = {
		enabled: true,
		quality: clampInt(config.defaultQuality, 1, 100, 82),
		maxDim: clampInt(config.maxDim, 100, 10000, 2460),
		keepOriginal: !!config.defaultBackup,
		inspect: false,
	};

	let encoder = null; // Squoosh libwebp encoder, loaded below
	let encoderFailed = false;
	// Not awaited: the uploader hooks below must be installed before DOM-ready
	// builds the page's uploaders (media-new.php, Library grid). Encodes await it.
	const encoderReady = import('./vendor/@jsquash/webp/index.js').then(
		(mod) => {
			encoder = mod;
			console.info('[DS WebP Squoosh] encoder ready (Squoosh libwebp WASM).');
		},
		(err) => {
			encoderFailed = true;
			console.error('[DS WebP Squoosh] encoder unavailable — uploads will pass through unconverted:', err);
			showBarStatus('⚠ Encoder failed to load — files upload unconverted.', 'warn');
		}
	);

	/* ------------------------------------------------------------------ *
	 *  Tooling
	 * ------------------------------------------------------------------ */
	function clampInt(value, min, max, fallback) {
		const n = parseInt(value, 10);
		if (Number.isNaN(n)) return fallback;
		return Math.min(max, Math.max(min, n));
	}

	function formatBytes(bytes) {
		if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
		return Math.max(1, Math.round(bytes / 1024)) + ' KB';
	}

	/* ------------------------------------------------------------------ *
	 *  Bar status line (encoder health + live conversion progress)
	 * ------------------------------------------------------------------ */
	let dsPending = 0; // files converting across all active batches
	const dsResults = { ok: 0, fail: 0, saved: 0 };

	function showBarStatus(text, level) {
		document.querySelectorAll('.ds-webp-bar [data-role=status]').forEach((el) => {
			el.textContent = text || '';
			el.classList.toggle('is-warn', level === 'warn');
		});
		clearTimeout(showBarStatus.timer);
		if (text) showBarStatus.timer = setTimeout(() => showBarStatus(''), 15000);
	}

	/* ------------------------------------------------------------------ *
	 *  Encoding: Browser decode → optional downscale → Squoosh libwebp
	 * ------------------------------------------------------------------ */
	async function fileToImageData(file) {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(1, state.maxDim / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) {
			bitmap.close();
			throw new Error('Canvas 2D context unavailable.');
		}
		ctx.imageSmoothingEnabled = scale < 1;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		return ctx.getImageData(0, 0, width, height);
	}

	async function encodeImageDataToBlob(imageData, quality) {
		await encoderReady;
		if (!encoder) throw new Error('Encoder not loaded.');
		const buffer = await encoder.encode(imageData, {
			quality: clampInt(quality, 1, 100, 82),
			method: 4,
		});
		return new Blob([buffer], { type: 'image/webp' });
	}

	function makeWebpFile(rawFile, blob, qualityUsed) {
		const name = rawFile.name.replace(/\.(jpe?g|png)$/i, '') + '.webp';
		const file = new File([blob], name, { type: 'image/webp', lastModified: Date.now() });
		file._dsQuality = clampInt(qualityUsed, 1, 100, 82);
		file._dsOrigSize = rawFile.size;
		return file;
	}

	/**
	 * Convert a raw JPEG/PNG File into a WebP File. Resolves to null when the
	 * user picked "upload original" in the preview modal (caller falls back).
	 */
	async function toWebpFile(rawFile, requestedQuality) {
		if (state.inspect) {
			const result = await openInspectModal(rawFile, requestedQuality);
			if (!result) return null; // "Upload original"
			return makeWebpFile(rawFile, result.blob, result.quality);
		}

		const imageData = await fileToImageData(rawFile);
		const blob = await encodeImageDataToBlob(imageData, requestedQuality);
		return makeWebpFile(rawFile, blob, requestedQuality);
	}

	/* ------------------------------------------------------------------ *
	 *  Control bar (On/Off · quality · keep original · preview)
	 * ------------------------------------------------------------------ */
	const BAR_HOST_SELECTOR = '.upload-ui, #plupload-upload-ui, .media-frame-uploader';

	function renderControlBar(container) {
		if (container._dsBar || !document.body.contains(container)) return;
		container._dsBar = true;

		const bar = document.createElement('div');
		bar.className = 'ds-webp-bar';
		bar.innerHTML = `
			<label class="ds-webp-bar__toggle" title="Convert added JPEG/PNG files to WebP in this browser">
				<input type="checkbox" data-role="enabled" ${state.enabled ? 'checked' : ''} />
				<span>DS WebP</span>
			</label>
			<label class="ds-webp-bar__quality" title="WebP quality (1–100)">
				<span data-role="quality-label">${state.quality}%</span>
				<input type="range" min="1" max="100" value="${state.quality}" data-role="quality" />
			</label>
			<label class="ds-webp-bar__check" title="Store the untouched original in uploads/ds-originals/">
				<input type="checkbox" data-role="keep-original" ${state.keepOriginal ? 'checked' : ''} />
				<span>Keep Original</span>
			</label>
			<label class="ds-webp-bar__check" title="Open a before/after quality preview for each converted image">
				<input type="checkbox" data-role="inspect" ${state.inspect ? 'checked' : ''} />
				<span>Preview</span>
			</label>
			<span class="ds-webp-bar__status" data-role="status" aria-live="polite"></span>
			<span class="ds-webp-bar__hint" title="Uses Squoosh's libwebp encoder — all conversion happens in this browser, nothing runs on the server. Images over ${state.maxDim}px on the longest edge are downscaled.">?</span>
		`;

		const nodes = {
			enabled: bar.querySelector('[data-role=enabled]'),
			quality: bar.querySelector('[data-role=quality]'),
			qualityLabel: bar.querySelector('[data-role=quality-label]'),
		keepOriginal: bar.querySelector('[data-role=keep-original]'),
		inspect: bar.querySelector('[data-role=inspect]'),
		status: bar.querySelector('[data-role=status]'),
	};

		if (encoderFailed) {
			nodes.status.textContent = '⚠ Encoder failed to load — files upload unconverted.';
			nodes.status.classList.add('is-warn');
		}

		nodes.enabled.addEventListener('change', () => persist({ enabled: nodes.enabled.checked }));
		nodes.quality.addEventListener('input', () => {
			nodes.qualityLabel.textContent = nodes.quality.value + '%';
			persist({ quality: Number(nodes.quality.value) });
		});
		nodes.keepOriginal.addEventListener('change', () => persist({ keepOriginal: nodes.keepOriginal.checked }));
		nodes.inspect.addEventListener('change', () => persist({ inspect: nodes.inspect.checked }));
		container.prepend(bar);
	}

	function persist(partials) {
		Object.assign(state, partials);
		try { localStorage.setItem(LOCK_KEY, JSON.stringify(state)); } catch (err) { /* non-fatal */ }
		syncAllBars();
	}

	function syncAllBars() {
		document.querySelectorAll('.ds-webp-bar').forEach((bar) => {
			bar.querySelector('[data-role=enabled]').checked = state.enabled;
			bar.querySelector('[data-role=quality]').value = state.quality;
			bar.querySelector('[data-role=quality-label]').textContent = state.quality + '%';
			bar.querySelector('[data-role=keep-original]').checked = state.keepOriginal;
			bar.querySelector('[data-role=inspect]').checked = state.inspect;
		});
	}

	(function restoreSaved() {
		try {
			const saved = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
			if (!saved) return;
			state.enabled = saved.enabled !== false;
			state.quality = clampInt(saved.quality, 1, 100, state.quality);
			state.keepOriginal = !!saved.keepOriginal;
			state.inspect = !!saved.inspect;
		} catch (err) { /* non-fatal */ }
	})();

	function mountBars() {
		document.querySelectorAll(BAR_HOST_SELECTOR).forEach((container) => {
			if (container._dsBar) return;
			// In a media frame, prefer the highest uploader surface present.
			if (container.classList.contains('media-frame-uploader') && container.querySelector('.upload-ui, #plupload-upload-ui')) {
				return;
			}
			renderControlBar(container);
		});
	}

	if (document.body) {
		new MutationObserver(mountBars).observe(document.body, { childList: true, subtree: true });
	}
	mountBars(); // module scripts run after DOM parse — most bars already exist

	/* ------------------------------------------------------------------ *
	 *  Preview modal (before/after with live savings)
	 * ------------------------------------------------------------------ */
	function openInspectModal(rawFile, initialQuality) {
		return new Promise((resolve) => {
			const originalURL = URL.createObjectURL(rawFile);
			let latestBlob = null;
			let latestURL = null;
			let renderTimer = null;
			let busy = false;
			let imageDataCache = null;

			const overlay = document.createElement('div');
			overlay.className = 'ds-webp-modal';
			overlay.innerHTML = `
				<div class="ds-webp-modal__panel" role="dialog" aria-modal="true" aria-label="WebP quality preview">
					<header class="ds-webp-modal__head">
						<strong>DS WebP Studio — Preview</strong>
						<button type="button" class="ds-webp-modal__close" aria-label="Close">&times;</button>
					</header>
					<div class="ds-webp-modal__body">
						<figure class="ds-webp-modal__fig">
							<figcaption>Original — <span data-role="orig-size"></span></figcaption>
							<img data-role="orig" alt="Original image preview" />
						</figure>
						<figure class="ds-webp-modal__fig">
							<figcaption>WebP — <span data-role="webp-size"></span></figcaption>
							<img data-role="webp" alt="WebP preview" />
						</figure>
					</div>
					<div class="ds-webp-modal__controls">
						<label>
							Quality <span data-role="q-label"></span>
							<input type="range" min="1" max="100" />
						</label>
						<span class="ds-webp-modal__savings" data-role="savings"></span>
					</div>
					<footer class="ds-webp-modal__foot">
						<button type="button" class="button" data-role="skip">Upload original</button>
						<button type="button" class="button button-primary" data-role="confirm">Upload WebP</button>
					</footer>
				</div>`;
			document.body.appendChild(overlay);

			const nodes = {
				qLabel: overlay.querySelector('[data-role=q-label]'),
				range: overlay.querySelector('input[type=range]'),
				origSize: overlay.querySelector('[data-role=orig-size]'),
				webpSize: overlay.querySelector('[data-role=webp-size]'),
				savings: overlay.querySelector('[data-role=savings]'),
				webpImg: overlay.querySelector('[data-role=webp]'),
			};

			nodes.range.value = initialQuality;
			nodes.qLabel.textContent = initialQuality + '%';
			nodes.origSize.textContent = formatBytes(rawFile.size);
			overlay.querySelector('[data-role=orig]').src = originalURL;

			async function reencode(immediate) {
				clearTimeout(renderTimer);
				if (busy) { renderTimer = setTimeout(() => reencode(true), 300); return; }
				busy = true;
				nodes.webpSize.textContent = '…';
				nodes.savings.textContent = '';
				try {
					imageDataCache = imageDataCache || await fileToImageData(rawFile);
					const blob = await encodeImageDataToBlob(imageDataCache, Number(nodes.range.value));
					latestBlob = blob;
					if (latestURL) URL.revokeObjectURL(latestURL);
					latestURL = URL.createObjectURL(blob);
					nodes.webpImg.src = latestURL;
					nodes.webpSize.textContent = formatBytes(blob.size);
					const savedPct = 100 - Math.round((blob.size / rawFile.size) * 100);
					nodes.savings.textContent = savedPct > 0 ? savedPct + '% smaller' : 'No savings at this quality';
				} catch (err) {
					console.warn('[DS WebP Squoosh] preview encode failed:', err);
					nodes.webpSize.textContent = 'failed — try again, or upload original';
				} finally {
					busy = false;
				}
			}

			nodes.range.addEventListener('input', () => {
				nodes.qLabel.textContent = nodes.range.value + '%';
				renderTimer = setTimeout(() => reencode(true), 250);
			});

			function close(sendWebp) {
				document.removeEventListener('keydown', onKey);
				overlay.remove();
				URL.revokeObjectURL(originalURL);
				if (latestURL) URL.revokeObjectURL(latestURL);
				resolve(sendWebp && latestBlob ? { blob: latestBlob, quality: Number(nodes.range.value) } : null);
			}

			function onKey(e) { if (e.key === 'Escape') close(false); }
			document.addEventListener('keydown', onKey);

			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) close(false);
				else if (e.target.classList.contains('ds-webp-modal__close')) close(false);
				else if (e.target.dataset.role === 'skip') close(false);
				else if (e.target.dataset.role === 'confirm') {
					if (latestBlob) persist({ quality: Number(nodes.range.value) });
					close(!!latestBlob);
				}
			});

			reencode(true);
		});
	}

	/* ------------------------------------------------------------------ *
	 *  Plupload / wp.Uploader integration
	 * ------------------------------------------------------------------ */
	function getNativeFile(plFile) {
		return (plFile.getNative && plFile.getNative()) || (plFile.getSource && plFile.getSource()) || null;
	}

	function isConvertTarget(plFile) {
		const native = getNativeFile(plFile) || plFile;
		if (plFile._dsProcessed || native._dsProcessed) return false;
		return /\.(jpe?g|png)$/i.test(String(plFile.name || ''));
	}

	// Above core's FilesAdded handlers (priority 0), which build the attachment
	// tiles and call up.start() — they must never see a raw JPEG/PNG.
	const FILES_ADDED_PRIORITY = 100;

	/**
	 * Synchronously pulls the whole batch out of the queue and returns false to
	 * stop core's handlers; every file is re-added later (converted, or as-is),
	 * and core handles that re-add normally, starting its upload.
	 */
	function interceptAddedFiles(up, addedFiles) {
		const targets = addedFiles.filter(isConvertTarget);
		if (!targets.length || !state.enabled) return true;
		if (encoderFailed) {
			// Graceful pass-through — but say so, since silence here looks broken.
			showBarStatus('⚠ Encoder failed to load — files upload unconverted.', 'warn');
			return true;
		}

		// Natives first: removeFile destroys the plupload wrappers.
		const natives = addedFiles.map((f) => getNativeFile(f) || f);
		addedFiles.forEach((f) => up.removeFile(f));
		const rawTargets = natives.filter((n, i) => targets.includes(addedFiles[i]));
		natives.forEach((n, i) => { if (!targets.includes(addedFiles[i])) up.addFile(n); });

		void convertBatch(up, rawTargets);
		return false;
	}

	async function convertBatch(up, rawTargets) {
		// Snapshot Keep Original at queue time: a mid-batch toggle flip must not change it.
		const keepOriginal = state.keepOriginal;

		dsPending += rawTargets.length;
		showBarStatus(`⏳ Converting ${dsPending} file${dsPending === 1 ? '' : 's'} in this browser…`);

		for (const rawFile of rawTargets) {
			try {
				const webpFile = await toWebpFile(rawFile, state.quality);
				if (webpFile) {
					if (keepOriginal && webpFile._dsOrigSize !== webpFile.size) {
						webpFile._dsKeepBackup = true;
						webpFile._dsRawBackup = rawFile;
					}
					dsResults.saved += Math.max(0, rawFile.size - webpFile.size);
					up.addFile(webpFile);
				} else {
					rawFile._dsProcessed = true;
					up.addFile(rawFile);
				}
			} catch (err) {
				console.warn('[DS WebP Squoosh] conversion failed, uploading original:', rawFile.name, err);
				rawFile._dsProcessed = true;
				up.addFile(rawFile);
				dsResults.fail += 1;
			}
			// Success/fallback accounted identically: keep the live count honest.
			dsResults.ok += 1;
			dsPending = Math.max(0, dsPending - 1);
			if (dsPending > 0) showBarStatus(`⏳ Converting ${dsPending} file${dsPending === 1 ? '' : 's'}…`);
			else reportResults();
		}
	}

	function reportResults() {
		if (dsResults.fail) {
			showBarStatus(`⚠ ${dsResults.fail} file${dsResults.fail === 1 ? '' : 's'} could not be converted — uploaded as original.`, 'warn');
		} else if (dsResults.saved > 0) {
			showBarStatus(`✓ ${dsResults.ok} converted · saved ${formatBytes(dsResults.saved)}`);
		} else {
			showBarStatus(`✓ ${dsResults.ok} converted (no smaller at this quality)`);
		}
		dsResults.ok = 0;
		dsResults.fail = 0;
		dsResults.saved = 0;
	}

	const pendingBackups = new Map(); // plupload file id → raw original File

	function uploadVaultCopy(attachmentId, rawFile) {
		const fd = new FormData();
		fd.append('action', String(config.ajaxAction || 'ds_save_original_backup'));
		fd.append('nonce', String(config.nonce || ''));
		fd.append('attachment_id', String(attachmentId));
		fd.append('original_file', rawFile, rawFile.name);

		fetch(String(config.ajaxUrl || 'admin-ajax.php'), { method: 'POST', body: fd, credentials: 'same-origin' })
			.then((res) => (res.ok ? res.json().catch(() => null) : Promise.reject(new Error('HTTP ' + res.status))))
			.then((json) => {
				if (!json || !json.success) {
					console.warn('[DS WebP Squoosh] vault backup failed for', rawFile.name, json);
				}
			})
			.catch((err) => console.warn('[DS WebP Squoosh] vault backup failed for', rawFile.name, err));
	}

	function bindPluploadInstance(up) {
		if (!up || up._dsBound) return;
		up._dsBound = true;

		up.bind('FilesAdded', (up2, addedFiles) => {
			// plupload's addFile builds each queue wrapper fresh and copies none of
			// the native File's custom properties, so stamp our staging slots onto
			// the wrapper here (one FilesAdded per re-entrant addFile of a converted
			// file, before its upload can start).
			addedFiles.forEach((f) => {
				const native = getNativeFile(f) || f;
				if (native._dsProcessed) f._dsProcessed = true;
				if (native._dsQuality !== undefined) {
					f._dsQuality = native._dsQuality;
					f._dsOrigSize = native._dsOrigSize;
				}
				if (native._dsKeepBackup) pendingBackups.set(f.id, native._dsRawBackup);
			});
			return interceptAddedFiles(up2, addedFiles);
		}, null, FILES_ADDED_PRIORITY);

		up.bind('BeforeUpload', (up2, file) => {
			up2.settings.multipart_params = up2.settings.multipart_params || {};
			if (file._dsQuality) {
				up2.settings.multipart_params._ds_webp_quality = file._dsQuality;
				up2.settings.multipart_params._ds_orig_size = file._dsOrigSize || 0;
			} else {
				delete up2.settings.multipart_params._ds_webp_quality;
				delete up2.settings.multipart_params._ds_orig_size;
			}
		});

		up.bind('FileUploaded', (up2, file, res) => {
			// The queue-time snapshot decides (keyed by plupload file id) — no
			// re-read of the current toggle.
			const rawFile = pendingBackups.get(file.id);
			if (!rawFile) return;
			pendingBackups.delete(file.id);

			let attachmentId = 0;
			try {
				const parsed = JSON.parse(String((res && res.response) || ''));
				attachmentId = (parsed && parsed.data && parsed.data.id) ? parsed.data.id : (parsed.id || 0);
			} catch (err) {
				const text = String((res && res.response) || '').trim();
				if (/^\d+$/.test(text)) attachmentId = parseInt(text, 10);
			}
			if (attachmentId) uploadVaultCopy(attachmentId, rawFile);
			else console.warn('[DS WebP Squoosh] no attachment id returned; original not vaulted for', file.name);
		});
	}

	function overrideWpUploader() {
		if (typeof window.wp === 'undefined' || typeof window.wp.Uploader !== 'function') return false;

		// wp.Uploader.prototype.init is invoked (via Backbone initialize) for every
		// new uploader view with this.uploader ready. Wrap both defensively.
		['init', 'initialize'].forEach((method) => {
			const orig = window.wp.Uploader.prototype[method];
			if (orig && orig._dsWrapped) return;
			const wrapper = function () {
				const result = orig ? orig.apply(this, arguments) : undefined;
				if (this && this.uploader) bindPluploadInstance(this.uploader);
				return result;
			};
			wrapper._dsWrapped = true;
			window.wp.Uploader.prototype[method] = wrapper;
		});
		return true;
	}

	if (!overrideWpUploader()) {
		// wp.Uploader not ready yet on older admin screens — poll briefly.
		let tries = 0;
		const timer = setInterval(() => {
			tries += 1;
			if (overrideWpUploader() || tries > 120) clearInterval(timer);
		}, 250);
	}

	// Standalone uploaders: /wp-admin/media-new.php and media-upload.php
	window.addEventListener('load', () => {
		const view = window.uploader;
		if (!view || view._dsBound) return;
		const pluploader = view.uploader || (view.view && view.view.uploader) || view;
		if (pluploader.bind) bindPluploadInstance(pluploader);
	});
})();
