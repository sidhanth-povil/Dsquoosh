// Converter: a lazy pool of module workers with a permanent main-thread fallback.
import { decodeAndEncode } from './convert-worker.js';

const MAX_POOL = 3;
const WORKER_URL = new URL('./convert-worker.js', import.meta.url);
const WEBP = 'image/webp';
const LOG = '[DS WebP Squoosh]';

class WorkerFailure extends Error {}

const toBlob = (buffer) => new Blob([buffer], { type: WEBP });

function newWorker() {
	try {
		return new Worker(WORKER_URL, { type: 'module' });
	} catch (err) {
		throw new WorkerFailure(String((err && err.message) || err));
	}
}

function spawnSlot() {
	const slot = { worker: newWorker(), pending: new Map(), dead: false };
	slot.worker.onmessage = ({ data }) => {
		const job = slot.pending.get(data.id);
		if (!job) return;
		slot.pending.delete(data.id);
		if (data.ok) job.resolve(data.buffer);
		else job.reject(new Error(data.error));
	};
	slot.worker.onerror = (event) => {
		event.preventDefault();
		slot.dead = true;
		slot.worker.terminate();
		const failure = new WorkerFailure(event.message || 'worker error');
		slot.pending.forEach((job) => job.reject(failure));
		slot.pending.clear();
	};
	return slot;
}

function createPool(size) {
	let slots = [];
	let nextId = 1;

	function pickSlot() {
		slots = slots.filter((s) => !s.dead);
		const idle = slots.reduce((best, s) => (!best || s.pending.size < best.pending.size ? s : best), null);
		if (idle && (idle.pending.size === 0 || slots.length >= size)) return idle;
		const slot = spawnSlot();
		slots = [...slots, slot];
		return slot;
	}

	return {
		run(file, quality, maxDim) {
			const slot = pickSlot();
			const id = nextId++;
			return new Promise((resolve, reject) => {
				slot.pending.set(id, { resolve, reject });
				slot.worker.postMessage({ id, file, quality, maxDim });
			});
		},
		dispose() {
			slots.forEach((s) => {
				s.worker.terminate();
				s.pending.forEach((job) => job.reject(new Error('converter disposed')));
			});
			slots = [];
		},
	};
}

export function createConverter({ maxDim, poolSize }) {
	const size = poolSize || Math.min(MAX_POOL, navigator.hardwareConcurrency || 2);
	let mainThread = typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined';
	let workerProven = false;
	const pool = createPool(size);

	const onMain = async (file, quality) => (await decodeAndEncode(file, quality, maxDim)).buffer;

	async function convert(file, quality) {
		if (mainThread) return toBlob(await onMain(file, quality));
		try {
			const buffer = await pool.run(file, quality, maxDim);
			workerProven = true;
			return toBlob(buffer);
		} catch (err) {
			// Only a worker-level failure before any worker ever succeeded flips the mode.
			if (!(err instanceof WorkerFailure) || workerProven) throw err;
			console.warn(LOG, 'workers unavailable, converting on the main thread:', err && err.message);
			mainThread = true;
			pool.dispose();
			return toBlob(await onMain(file, quality));
		}
	}

	async function canDecode(file) {
		try {
			const bitmap = await createImageBitmap(file);
			bitmap.close();
			return true;
		} catch {
			return false;
		}
	}

	return { convert, canDecode, dispose: pool.dispose };
}
