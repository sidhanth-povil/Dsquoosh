// Converter: a lazy pool of module workers with a permanent main-thread fallback.
import { decodeAndEncode } from './convert-worker.js';

const MAX_POOL = 3;
// ponytail: fixed per-job ceiling; a huge image on a very slow device could exceed it
// (the file then uploads unconverted). Make it size-aware if that shows up in practice.
export const JOB_TIMEOUT_MS = 60_000;
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

function settle(slot, id) {
	const job = slot.pending.get(id);
	if (job) {
		clearTimeout(job.timer);
		slot.pending.delete(id);
	}
	return job;
}

// Terminates the worker and rejects everything it was holding.
function kill(slot, failure) {
	slot.dead = true;
	slot.worker.terminate();
	[...slot.pending.keys()].forEach((id) => settle(slot, id).reject(failure));
}

function spawnSlot() {
	const slot = { worker: newWorker(), pending: new Map(), dead: false };
	slot.worker.onmessage = ({ data }) => {
		const job = settle(slot, data.id);
		if (!job) return;
		if (data.ok) job.resolve(data.buffer);
		else job.reject(new Error(data.error));
	};
	slot.worker.onerror = (event) => {
		if (event && event.preventDefault) event.preventDefault();
		kill(slot, new WorkerFailure((event && event.message) || 'worker error'));
	};
	slot.worker.onmessageerror = () => kill(slot, new WorkerFailure('worker message could not be deserialized'));
	return slot;
}

function createPool(size, timeoutMs) {
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
				const timer = setTimeout(() => kill(slot, new WorkerFailure('worker timed out')), timeoutMs);
				slot.pending.set(id, { resolve, reject, timer });
				slot.worker.postMessage({ id, file, quality, maxDim });
			});
		},
		dispose() {
			slots.forEach((s) => kill(s, new Error('converter disposed')));
			slots = [];
		},
	};
}

export function createConverter({ maxDim, poolSize, jobTimeoutMs = JOB_TIMEOUT_MS }) {
	const size = poolSize || Math.min(MAX_POOL, navigator.hardwareConcurrency || 2);
	let mainThread = typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined';
	let workerProven = false;
	const pool = createPool(size, jobTimeoutMs);

	const onMain = async (file, quality) => toBlob((await decodeAndEncode(file, quality, maxDim)).buffer);

	function switchToMain(err) {
		console.warn(LOG, 'workers unavailable, converting on the main thread:', err.message);
		mainThread = true;
		pool.dispose();
	}

	async function convert(file, quality) {
		if (mainThread) return onMain(file, quality);
		try {
			const buffer = await pool.run(file, quality, maxDim);
			workerProven = true;
			return toBlob(buffer);
		} catch (err) {
			// A worker-level failure before any worker ever succeeded flips the mode for good;
			// jobs caught in flight by that switch (sibling workers disposed) retry on main too.
			if (err instanceof WorkerFailure && !workerProven && !mainThread) switchToMain(err);
			if (!mainThread) throw err;
			return onMain(file, quality);
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
