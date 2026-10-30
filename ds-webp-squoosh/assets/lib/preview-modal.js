// Before/after WebP preview modal with a live quality slider.
const LOG = '[DS WebP Squoosh]';
const REENCODE_DEBOUNCE_MS = 250;

function formatBytes(bytes) {
	if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
	return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

const TEMPLATE = `
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

function buildOverlay(file, quality, originalURL) {
	const overlay = document.createElement('div');
	overlay.className = 'ds-webp-modal';
	overlay.innerHTML = TEMPLATE;
	const $ = (sel) => overlay.querySelector(sel);
	const nodes = {
		qLabel: $('[data-role=q-label]'),
		range: $('input[type=range]'),
		webpSize: $('[data-role=webp-size]'),
		savings: $('[data-role=savings]'),
		webpImg: $('[data-role=webp]'),
	};
	nodes.range.value = quality;
	nodes.qLabel.textContent = quality + '%';
	$('[data-role=orig-size]').textContent = formatBytes(file.size);
	$('[data-role=orig]').src = originalURL;
	return { overlay, nodes };
}

// Re-encodes at the slider's quality; the latest finished encode wins.
function createRenderer(file, nodes, encode) {
	const state = { blob: null, quality: null, url: null, seq: 0 };
	async function render() {
		const seq = ++state.seq;
		const quality = Number(nodes.range.value);
		nodes.webpSize.textContent = '…';
		nodes.savings.textContent = '';
		try {
			const blob = await encode(file, quality);
			if (seq !== state.seq) return;
			if (state.url) URL.revokeObjectURL(state.url);
			Object.assign(state, { blob, quality, url: URL.createObjectURL(blob) });
			nodes.webpImg.src = state.url;
			nodes.webpSize.textContent = formatBytes(blob.size);
			const savedPct = 100 - Math.round((blob.size / file.size) * 100);
			nodes.savings.textContent = savedPct > 0 ? savedPct + '% smaller' : 'No savings at this quality';
		} catch (err) {
			if (seq !== state.seq) return;
			console.warn(LOG, 'preview encode failed:', err);
			nodes.webpSize.textContent = 'failed — try again, or upload original';
		}
	}
	return { state, render };
}

/** Resolves { blob, quality } to upload the WebP, or null to upload the original. */
export function openPreviewModal(file, quality, encode) {
	return new Promise((resolve) => {
		const originalURL = URL.createObjectURL(file);
		const { overlay, nodes } = buildOverlay(file, quality, originalURL);
		const { state, render } = createRenderer(file, nodes, encode);
		let timer = null;

		function close(sendWebp) {
			clearTimeout(timer);
			state.seq += 1; // drop any in-flight encode
			document.removeEventListener('keydown', onKey);
			overlay.remove();
			URL.revokeObjectURL(originalURL);
			if (state.url) URL.revokeObjectURL(state.url);
			resolve(sendWebp && state.blob ? { blob: state.blob, quality: state.quality } : null);
		}
		function onKey(e) { if (e.key === 'Escape') close(false); }

		nodes.range.addEventListener('input', () => {
			nodes.qLabel.textContent = nodes.range.value + '%';
			clearTimeout(timer);
			timer = setTimeout(render, REENCODE_DEBOUNCE_MS);
		});
		overlay.addEventListener('click', (e) => {
			const role = e.target.dataset.role;
			if (role === 'confirm') { if (state.blob) close(true); } // wait for a first encode
			else if (e.target === overlay || role === 'skip' || e.target.classList.contains('ds-webp-modal__close')) close(false);
		});
		document.addEventListener('keydown', onKey);
		document.body.appendChild(overlay);
		render();
	});
}
