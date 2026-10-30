import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile, isAnimatedGif } from '../../ds-webp-squoosh/assets/lib/classify.js';
import { STATIC_GIF, ANIMATED_GIF, buildGif } from './gif-bytes.mjs';

const yes = { canDecode: async () => true };
const no = { canDecode: async () => false };
const file = (parts, type) => new File(parts, 'a', { type });

test('webp, avif, svg pass through as web-format', async () => {
	for (const type of ['image/webp', 'image/avif', 'image/svg+xml'])
		assert.deepEqual(await classifyFile(file(['x'], type), yes), { convert: false, reason: 'web-format' });
});

test('text/plain -> not-image', async () => {
	assert.deepEqual(await classifyFile(file(['x'], 'text/plain'), yes), { convert: false, reason: 'not-image' });
});

test('jpeg, png, bmp decodable -> convert', async () => {
	for (const type of ['image/jpeg', 'image/png', 'image/bmp'])
		assert.deepEqual(await classifyFile(file(['x'], type), yes), { convert: true, reason: null });
});

test('image/heic with canDecode false -> undecodable', async () => {
	assert.deepEqual(await classifyFile(file(['x'], 'image/heic'), no), { convert: false, reason: 'undecodable' });
});

test('ANIMATED_GIF -> animated; STATIC_GIF -> convert', async () => {
	assert.deepEqual(await classifyFile(file([ANIMATED_GIF], 'image/gif'), yes), { convert: false, reason: 'animated' });
	assert.deepEqual(await classifyFile(file([STATIC_GIF], 'image/gif'), yes), { convert: true, reason: null });
});

test('malformed GIF is treated as animated and never converted', async () => {
	const junk = file([new Uint8Array([1, 2, 3])], 'image/gif');
	assert.deepEqual(await classifyFile(junk, yes), { convert: false, reason: 'animated' });
});

test('jpeg, png, bmp, gif skip the canDecode probe', async () => {
	let probes = 0;
	const spy = { canDecode: async () => { probes += 1; return false; } };
	for (const [type, body] of [['image/jpeg', 'x'], ['image/png', 'x'], ['image/bmp', 'x'], ['image/gif', STATIC_GIF]])
		assert.deepEqual(await classifyFile(file([body], type), spy), { convert: true, reason: null });
	assert.equal(probes, 0);
});

test('isAnimatedGif basics', () => {
	assert.equal(isAnimatedGif(STATIC_GIF), false);
	assert.equal(isAnimatedGif(ANIMATED_GIF), true);
	assert.equal(isAnimatedGif(STATIC_GIF.slice(0, 20)), true, 'truncated');
	const unknown = Uint8Array.from(STATIC_GIF);
	unknown[unknown.indexOf(0x2c)] = 0x99;
	assert.equal(isAnimatedGif(unknown), true, 'unknown block byte');
});

test('isAnimatedGif skips extension sub-blocks and local color tables', () => {
	const staticLocal = buildGif({ frames: 1, localTableOnFirst: true, comment: true, netscape: true });
	assert.equal(isAnimatedGif(staticLocal), false);
	const animLocal = buildGif({ frames: 2, localTableOnFirst: true, comment: true });
	assert.equal(isAnimatedGif(animLocal), true);
});
