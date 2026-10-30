/**
 * DS WebP Squoosh Studio — client-side WebP converter for the WP admin (entry module).
 *
 * Every image added to a wp-admin uploader runs through the shared pipeline: it is
 * classified, encoded to WebP in this browser (Squoosh libwebp WASM, worker pool),
 * and the WebP uploads only when it is smaller. Anything else — and any failure —
 * uploads the untouched original. The server does no image processing.
 */
import { createSettings, clampInt } from './lib/settings.js';
import { classifyFile } from './lib/classify.js';
import { createConverter } from './lib/convert.js';
import { processFile } from './lib/pipeline.js';
import { createJobStore } from './lib/jobs.js';
import { installPluploadAdapter } from './lib/plupload-adapter.js';
import { vaultOriginal } from './lib/vault.js';
import { openPreviewModal } from './lib/preview-modal.js';

const DEFAULT_MAX_DIM = 2460;
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

const settings = createSettings(config, resolveStorage());
const converter = createConverter({ maxDim: clampInt(config.maxDim, 100, 10000, DEFAULT_MAX_DIM) });
const jobs = createJobStore();
const jobIds = new WeakMap(); // original File -> job id
const keepOriginalAtQueue = new WeakMap(); // original File -> Keep Original snapshot

// One preview modal at a time: concurrent files wait their turn.
let previewChain = Promise.resolve();
function preview(file, quality) {
	const next = previewChain.then(() => openPreviewModal(file, quality, converter.convert));
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
	return processFile(file, {
		settings: current,
		serverSupportsWebp: serverSupportsWebp && config.webpSupported !== false,
		classify: (f) => classifyFile(f, converter),
		convert: converter.convert,
		preview,
		onStage,
	});
}

function onUploaded(result, attachmentId) {
	if (!result.converted || !keepOriginalAtQueue.get(result.original)) return;
	void vaultOriginal(config, attachmentId, result.original);
}

installPluploadAdapter({ process, onUploaded });
