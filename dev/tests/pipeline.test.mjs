import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { processFile } from '../../ds-webp-squoosh/assets/lib/pipeline.js';

mock.method(console, 'warn', () => {}); // keep expected failure logs out of test output

const webp = (n) => async () => new Blob([new Uint8Array(n)], { type: 'image/webp' });
const jpg = new File([new Uint8Array(1000)], 'photo.final.JPG', { type: 'image/jpeg' });
const base = {
	settings: { enabled: true, quality: 82, keepOriginal: false, preview: false },
	serverSupportsWebp: true,
	classify: async () => ({ convert: true, reason: null }),
};
const neverConvert = async () => { throw new Error('convert must not be called'); };

test('smaller webp -> converted result with .webp name', async () => {
	const r = await processFile(jpg, { ...base, convert: webp(400) });
	assert.equal(r.converted, true);
	assert.equal(r.reason, null);
	assert.equal(r.file.name, 'photo.final.webp');
	assert.equal(r.file.type, 'image/webp');
	assert.equal(r.file.size, 400);
	assert.equal(r.quality, 82);
	assert.equal(r.origSize, 1000);
	assert.equal(r.original, jpg);
	assert.ok(Object.isFrozen(r));
});

test('name without extension gets .webp appended', async () => {
	const f = new File([new Uint8Array(10)], 'scan', { type: 'image/png' });
	const r = await processFile(f, { ...base, convert: webp(5) });
	assert.equal(r.file.name, 'scan.webp');
});

test('webp not smaller -> original, reason larger', async () => {
	const r = await processFile(jpg, { ...base, convert: webp(1000) });
	assert.equal(r.converted, false);
	assert.equal(r.reason, 'larger');
	assert.equal(r.file, jpg);
	assert.equal(r.quality, null);
});

test('convert rejects -> original, reason failed', async () => {
	const r = await processFile(jpg, { ...base, convert: async () => { throw new Error('boom'); } });
	assert.equal(r.reason, 'failed');
	assert.equal(r.file, jpg);
});

test('classify throws -> failed, never rejects', async () => {
	const r = await processFile(jpg, { ...base, classify: async () => { throw new Error('x'); }, convert: neverConvert });
	assert.equal(r.reason, 'failed');
});

test('disabled -> reason disabled, convert never called', async () => {
	const settings = { ...base.settings, enabled: false };
	const r = await processFile(jpg, { ...base, settings, convert: neverConvert });
	assert.equal(r.reason, 'disabled');
	assert.equal(r.file, jpg);
});

test('server without webp -> reason server-no-webp', async () => {
	const r = await processFile(jpg, { ...base, serverSupportsWebp: false, convert: neverConvert });
	assert.equal(r.reason, 'server-no-webp');
});

test('classifier animated -> reason animated', async () => {
	const classify = async () => ({ convert: false, reason: 'animated' });
	const r = await processFile(jpg, { ...base, classify, convert: neverConvert });
	assert.equal(r.reason, 'animated');
	assert.equal(r.converted, false);
});

test('preview null -> skipped-preview; preview blob+quality used when returned', async () => {
	const settings = { ...base.settings, preview: true };
	const skipped = await processFile(jpg, { ...base, settings, convert: neverConvert, preview: async () => null });
	assert.equal(skipped.reason, 'skipped-preview');
	assert.equal(skipped.file, jpg);

	const blob = new Blob([new Uint8Array(300)], { type: 'image/webp' });
	const used = await processFile(jpg, { ...base, settings, convert: neverConvert, preview: async () => ({ blob, quality: 60 }) });
	assert.equal(used.converted, true);
	assert.equal(used.quality, 60);
	assert.equal(used.file.size, 300);
});

test('settings snapshot at enqueue: caller mutating settings after call has no effect', async () => {
	const settings = { ...base.settings };
	let release;
	const gate = new Promise((r) => { release = r; });
	const classify = async () => { await gate; return { convert: true, reason: null }; };
	let usedQuality;
	const convert = async (f, q) => { usedQuality = q; return new Blob([new Uint8Array(10)]); };
	const pending = processFile(jpg, { ...base, settings, classify, convert });
	settings.quality = 10;
	settings.preview = true;
	release();
	const r = await pending;
	assert.equal(usedQuality, 82);
	assert.equal(r.quality, 82);
});

test('onStage gets converting then done with the original file; throwing onStage is ignored', async () => {
	const calls = [];
	const onStage = (stage, original, result) => { calls.push([stage, original, result]); throw new Error('ui bug'); };
	const r = await processFile(jpg, { ...base, convert: webp(400), onStage });
	assert.equal(r.converted, true);
	assert.deepEqual(calls.map((c) => c[0]), ['converting', 'done']);
	assert.equal(calls[0][1], jpg);
	assert.equal(calls[1][2], r);
});

test('onStage skips converting when nothing is encoded', async () => {
	const stages = [];
	await processFile(jpg, { ...base, serverSupportsWebp: false, convert: neverConvert, onStage: (s) => stages.push(s) });
	assert.deepEqual(stages, ['done']);
});
