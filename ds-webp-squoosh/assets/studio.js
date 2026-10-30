/**
 * DS WebP Squoosh Studio — client-side WebP converter for the WP admin (entry module).
 *
 * Every image added to a wp-admin uploader runs through the shared pipeline: it is
 * classified, encoded to WebP in this browser (Squoosh libwebp WASM, worker pool),
 * and the WebP uploads only when it is smaller. Anything else — and any failure —
 * uploads the untouched original. The server does no image processing.
 */
import { createSettings, clampInt, PRESETS, presetFor } from './lib/settings.js';
import { classifyFile } from './lib/classify.js';
import { createConverter } from './lib/convert.js';
import { processFile } from './lib/pipeline.js';
import { createJobStore } from './lib/jobs.js';
import { createLimiter } from './lib/limiter.js';
import { installPluploadAdapter } from './lib/plupload-adapter.js';
import { installRestAdapter } from './lib/rest-adapter.js';
import { vaultOriginal } from './lib/vault.js';
import { openPreviewModal } from './lib/preview-modal.js';
import { mountPanel, mountEditorButton } from './lib/panel.js';

const DEFAULT_MAX_DIM = 2460;
const MAX_CONCURRENT = 3; // files classified/converted at once; the rest show 'waiting'
const API_FETCH_POLL_MS = 250;
const API_FETCH_POLL_TRIES = 120; // 30 s
const UPLOAD_HOST_SELECTOR = '.upload-ui, #plupload-upload-ui, .media-frame-uploader, .uploader-inline';
const config = window.DSWebPConfig || {};

// localStorage access itself can throw (SecurityError when storage is blocked).
function resolveStorage() {
	try {
		const storage = window.localStorage;
		storage.getItem('dsWebpSettings');
		return storage;
	} catch {
		const memory = new Map();
		return { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)) };
	}
}

const maxBackupBytes = Number(config.maxBackupBytes) || Infinity;
const settings = createSettings(config, resolveStorage());
const converter = createConverter({ maxDim: clampInt(config.maxDim, 100, 10000, DEFAULT_MAX_DIM) });
const jobs = createJobStore();
const limit = createLimiter(MAX_CONCURRENT);
const jobIds = new WeakMap(); // original File -> job id
const keepOriginalAtQueue = new WeakMap(); // original File -> Keep Original snapshot

// One preview modal at a time: concurrent files wait their turn. A confirmed quality becomes the new setting.
let previewChain = Promise.resolve();
function preview(file, quality) {
	const next = previewChain.then(() => openPreviewModal(file, quality, converter.convert)).then((picked) => {
		if (picked) settings.set({ quality: picked.quality });
		return picked;
	});
	previewChain = next.catch(() => null);
	return next;
}

function onStage(stage, original, result) {
	const id = jobIds.get(original);
	jobs.update(id, stage === 'done' ? { status: 'done', result } : { status: stage });
}

function process(file, { serverSupportsWebp = true } = {}) {
	const current = settings.get();
	jobIds.set(file, jobs.add(file.name, file.size));
	keepOriginalAtQueue.set(file, current.keepOriginal);
	return limit(() => processFile(file, {
		settings: current,
		serverSupportsWebp: serverSupportsWebp && config.webpSupported !== false,
		classify: (f) => classifyFile(f, converter),
		convert: converter.convert,
		preview,
		onStage,
	}));
}

function onUploaded(result, attachmentId) {
	if (!result.converted || !keepOriginalAtQueue.get(result.original)) return;
	if (result.original.size > maxBackupBytes) return; // server would refuse it (413)
	void vaultOriginal(config, attachmentId, result.original);
}

// Leaving mid-conversion/upload would drop queued files: ask the browser to confirm.
const guardUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
let isGuarding = false;
jobs.subscribe((list) => {
	const busy = list.some((j) => j.status !== 'done');
	if (busy === isGuarding) return;
	isGuarding = busy;
	window[busy ? 'addEventListener' : 'removeEventListener']('beforeunload', guardUnload);
});

installPluploadAdapter({ process, onUploaded });

function mountUi() {
	const webpSupported = config.webpSupported !== false;
	const panel = mountPanel({ settings, jobs, presets: PRESETS, presetFor, webpSupported, uploadHostSelector: UPLOAD_HOST_SELECTOR });
	mountEditorButton(panel, settings, webpSupported);
}

if (document.body) mountUi(); else document.addEventListener('DOMContentLoaded', mountUi, { once: true });

// wp.apiFetch is a classic script, normally ready before this module runs; poll briefly if not.
function installRestAdapterWhenReady() {
	const tryInstall = () => {
		const apiFetch = window.wp && window.wp.apiFetch;
		if (!apiFetch || typeof apiFetch.use !== 'function') return false;
		installRestAdapter({ apiFetch, process, onUploaded });
		return true;
	};
	if (tryInstall()) return;
	let tries = 0;
	const timer = setInterval(() => {
		tries += 1;
		if (tryInstall() || tries >= API_FETCH_POLL_TRIES) clearInterval(timer);
	}, API_FETCH_POLL_MS);
}

installRestAdapterWhenReady();
