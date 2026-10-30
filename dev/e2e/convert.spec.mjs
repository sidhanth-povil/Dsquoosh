import { test, expect } from '@playwright/test';

const LIB = '/wp-content/mu-plugins/ds-webp-squoosh/assets/lib/convert.js';

// Runs inside the page: builds a PNG File, converts it, reports decoded size + header.
async function convertInPage({ lib, w, h, worker = 'real' }) {
	const constructed = { count: 0 };
	if (worker === 'undefined') {
		window.Worker = undefined;
	} else if (worker === 'throws') {
		window.Worker = class { constructor() { throw new Error('blocked by CSP'); } };
	} else {
		const Real = window.Worker;
		window.Worker = class extends Real {
			constructor(...args) { super(...args); constructed.count++; }
		};
	}
	const { createConverter } = await import(lib);
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#3a7'; ctx.fillRect(0, 0, w, h);
	ctx.fillStyle = '#c33'; ctx.fillRect(0, 0, w / 2, h / 2);
	const png = await canvas.convertToBlob({ type: 'image/png' });
	const file = new File([png], 'big.png', { type: 'image/png' });
	const converter = createConverter({ maxDim: 2460 });
	try {
		const blob = await converter.convert(file, 82);
		const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
		const bmp = await createImageBitmap(blob);
		const out = { type: blob.type, width: bmp.width, height: bmp.height,
			riff: String.fromCharCode(...head.slice(0, 4)), webp: String.fromCharCode(...head.slice(8, 12)),
			workers: constructed.count };
		bmp.close();
		return out;
	} finally {
		converter.dispose();
	}
}

test.beforeEach(async ({ page }) => {
	await page.goto('/wp-admin/');
});

test('downscales to maxDim', async ({ page }) => {
	const r = await page.evaluate(convertInPage, { lib: LIB, w: 8000, h: 6000 });
	expect([r.width, r.height]).toEqual([2460, 1845]);
});

test('worker output is RIFF/WEBP', async ({ page }) => {
	const r = await page.evaluate(convertInPage, { lib: LIB, w: 640, h: 480 });
	expect(r).toMatchObject({ type: 'image/webp', riff: 'RIFF', webp: 'WEBP', width: 640, height: 480 });
	expect(r.workers).toBeGreaterThan(0);
});

test('main-thread fallback when Worker is undefined', async ({ page }) => {
	const r = await page.evaluate(convertInPage, { lib: LIB, w: 640, h: 480, worker: 'undefined' });
	expect(r).toMatchObject({ type: 'image/webp', riff: 'RIFF', webp: 'WEBP', width: 640, height: 480, workers: 0 });
});

test('main-thread fallback when Worker construction throws', async ({ page }) => {
	const r = await page.evaluate(convertInPage, { lib: LIB, w: 640, h: 480, worker: 'throws' });
	expect(r).toMatchObject({ type: 'image/webp', riff: 'RIFF', webp: 'WEBP', width: 640, height: 480 });
});

test('canDecode resolves false for garbage, true for a real image', async ({ page }) => {
	const r = await page.evaluate(async (lib) => {
		const { createConverter } = await import(lib);
		const c = createConverter({ maxDim: 2460 });
		const bad = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
		const canvas = new OffscreenCanvas(4, 4);
		canvas.getContext('2d').fillRect(0, 0, 4, 4);
		const good = new File([await canvas.convertToBlob()], 'y.png', { type: 'image/png' });
		const out = [await c.canDecode(bad), await c.canDecode(good)];
		c.dispose();
		return out;
	}, LIB);
	expect(r).toEqual([false, true]);
});

// Builds a small PNG File inside the page.
const PNG_HELPER = `async (w, h) => {
	const c = new OffscreenCanvas(w, h);
	c.getContext('2d').fillRect(0, 0, w, h);
	return new File([await c.convertToBlob()], 'p.png', { type: 'image/png' });
}`;

async function isWebp(blob) {
	const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
	return blob.type === 'image/webp' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP';
}

test('workers that fail to load async: concurrent first jobs all retry on main thread', async ({ page }) => {
	const r = await page.evaluate(async ({ lib, png, isWebpSrc }) => {
		const makePng = eval(png);
		const checkWebp = eval(`(${isWebpSrc})`);
		// Like a CSP/404 module worker: construction succeeds, `error` fires later, per worker.
		window.Worker = class {
			constructor() {
				setTimeout(() => this.onerror && this.onerror({ message: 'load failed', preventDefault() {} }), 20);
			}
			postMessage() {}
			terminate() {}
		};
		const { createConverter } = await import(lib);
		const c = createConverter({ maxDim: 2460, poolSize: 3 });
		const files = await Promise.all([makePng(64, 64), makePng(80, 60), makePng(32, 32)]);
		const blobs = await Promise.all(files.map((f) => c.convert(f, 82)));
		c.dispose();
		return Promise.all(blobs.map(checkWebp));
	}, { lib: LIB, png: PNG_HELPER, isWebpSrc: isWebp.toString() });
	expect(r).toEqual([true, true, true]);
});

test('worker that never answers times out and falls back to main thread', async ({ page }) => {
	const ok = await page.evaluate(async ({ lib, png, isWebpSrc }) => {
		const makePng = eval(png);
		const checkWebp = eval(`(${isWebpSrc})`);
		window.Worker = class { postMessage() {} terminate() {} };
		const { createConverter } = await import(lib);
		const c = createConverter({ maxDim: 2460, jobTimeoutMs: 100 });
		const blob = await c.convert(await makePng(40, 40), 82);
		c.dispose();
		return checkWebp(blob);
	}, { lib: LIB, png: PNG_HELPER, isWebpSrc: isWebp.toString() });
	expect(ok).toBe(true);
});

test('proven pool: hung worker times out, job rejects, worker is replaced', async ({ page }) => {
	const r = await page.evaluate(async ({ lib, png }) => {
		const makePng = eval(png);
		const Real = window.Worker;
		const state = { hang: false, constructed: 0 };
		window.Worker = class extends Real {
			constructor(...a) { super(...a); state.constructed++; }
			postMessage(...a) { if (!state.hang) super.postMessage(...a); }
		};
		const { createConverter } = await import(lib);
		const c = createConverter({ maxDim: 2460, poolSize: 1, jobTimeoutMs: 1000 });
		const file = await makePng(40, 40);
		const first = (await c.convert(file, 82)).type;
		state.hang = true;
		const second = await c.convert(file, 82).then(() => 'resolved', (e) => e.message);
		state.hang = false;
		const third = (await c.convert(file, 82)).type;
		c.dispose();
		return { first, second, third, constructed: state.constructed };
	}, { lib: LIB, png: PNG_HELPER });
	expect(r).toEqual({ first: 'image/webp', second: 'worker timed out', third: 'image/webp', constructed: 2 });
});
