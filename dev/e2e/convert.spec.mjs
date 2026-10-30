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
