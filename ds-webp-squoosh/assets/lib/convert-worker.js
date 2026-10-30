// Decode -> downscale -> WebP encode. Runs as a module worker and is also
// imported by convert.js as the main-thread fallback.
import { encode } from '../vendor/@jsquash/webp/index.js';

const ENCODE_METHOD = 4;

function makeCanvas(width, height) {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	return Object.assign(document.createElement('canvas'), { width, height });
}

function readPixels(bitmap, maxDim) {
	const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const ctx = makeCanvas(width, height).getContext('2d');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, 0, 0, width, height);
	return ctx.getImageData(0, 0, width, height);
}

export async function decodeAndEncode(file, quality, maxDim) {
	const bitmap = await createImageBitmap(file);
	let imageData;
	try {
		imageData = readPixels(bitmap, maxDim);
	} finally {
		bitmap.close();
	}
	const buffer = await encode(imageData, { quality, method: ENCODE_METHOD });
	return { buffer, width: imageData.width, height: imageData.height };
}

const isWorkerScope = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

if (isWorkerScope) {
	self.onmessage = async ({ data: { id, file, quality, maxDim } }) => {
		try {
			const { buffer, width, height } = await decodeAndEncode(file, quality, maxDim);
			self.postMessage({ id, ok: true, buffer, width, height }, [buffer]);
		} catch (err) {
			self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
		}
	};
}
