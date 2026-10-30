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

// Pool: one shared FIFO; each worker runs one job at a time, so a job's timeout is
// armed only when it is posted and measures that job's own work, never queue wait.
function createPool(size, timeoutMs) {
	let slots = [];
	let queue = [];
	let nextId = 1;

	// Clears the slot's in-flight job and hands it to `outcome`.
	function finish(slot, outcome) {
		const job = slot.job;
		if (!job) return;
		clearTimeout(job.timer);
		slot.job = null;
		outcome(job);
	}

	// Terminates the worker; only its in-flight job fails, queued jobs move on.
	function kill(slot, failure) {
		slot.worker.terminate();
		slots = slots.filter((s) => s !== slot);
		finish(slot, (job) => job.reject(failure));
		dispatch();
	}

	function spawn() {
		const slot = { worker: newWorker(), job: null };
		slot.worker.onmessage = ({ data }) => {
			if (!slot.job || slot.job.id !== data.id) return;
			finish(slot, (job) => (data.ok ? job.resolve(data.buffer) : job.reject(new Error(data.error))));
			dispatch();
		};
		slot.worker.onerror = (event) => {
			if (event && event.preventDefault) event.preventDefault();
			kill(slot, new WorkerFailure((event && event.message) || 'worker error'));
		};
		slot.worker.onmessageerror = () => kill(slot, new WorkerFailure('worker message could not be deserialized'));
		slots = [...slots, slot];
		return slot;
	}

	function start(slot, job) {
		try {
			slot.worker.postMessage(job.message);
		} catch (err) {
			job.reject(err); // job-level (e.g. DataCloneError); the worker stays healthy
			return;
		}
		slot.job = { ...job, timer: setTimeout(() => kill(slot, new WorkerFailure('worker timed out')), timeoutMs) };
	}

	function dispatch() {
		while (queue.length) {
			let slot = slots.find((s) => !s.job);
			if (!slot && slots.length >= size) return;
			try {
				slot = slot || spawn();
			} catch (err) {
				const failed = queue;
				queue = [];
				failed.forEach((job) => job.reject(err));
				return;
			}
			const [job, ...rest] = queue;
			queue = rest;
			start(slot, job);
		}
	}

	return {
		run(file, quality, maxDim) {
			const id = nextId++;
			return new Promise((resolve, reject) => {
				queue = [...queue, { id, message: { id, file, quality, maxDim }, resolve, reject }];
				dispatch();
			});
		},
		dispose() {
			const disposed = new Error('converter disposed');
			const waiting = queue;
			queue = [];
			waiting.forEach((job) => job.reject(disposed));
			slots.forEach((slot) => {
				slot.worker.terminate();
				finish(slot, (job) => job.reject(disposed));
			});
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
