import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, presetFor, clampInt, PRESETS } from '../../ds-webp-squoosh/assets/lib/settings.js';

const CONFIG = { defaultQuality: 82, defaultBackup: false };
const KEY = 'dsWebpSettings';

function memoryStorage(initial = {}) {
	const data = { ...initial };
	return {
		getItem: (k) => (k in data ? data[k] : null),
		setItem: (k, v) => { data[k] = String(v); },
	};
}

test('set returns a new frozen object and persists', () => {
	const store = memoryStorage();
	const s = createSettings(CONFIG, store);
	const before = s.get();
	const after = s.set({ quality: 60 });
	assert.notEqual(before, after);
	assert.equal(before.quality, 82);
	assert.ok(Object.isFrozen(after));
	assert.equal(JSON.parse(store.getItem(KEY)).quality, 60);
});

test('defaults: enabled true, preview false, keepOriginal from config', () => {
	const s = createSettings({ defaultQuality: 82, defaultBackup: true }, memoryStorage()).get();
	assert.deepEqual({ ...s }, { enabled: true, quality: 82, keepOriginal: true, preview: false });
});

test('quality clamps to 1..100; non-numeric keeps previous', () => {
	const s = createSettings(CONFIG, memoryStorage());
	assert.equal(s.set({ quality: 500 }).quality, 100);
	assert.equal(s.set({ quality: -5 }).quality, 1);
	assert.equal(s.set({ quality: 'abc' }).quality, 1);
});

test('presetFor maps 60/82/92, null for 70', () => {
	assert.deepEqual({ ...PRESETS }, { smallest: 60, balanced: 82, sharp: 92 });
	assert.equal(presetFor(60), 'smallest');
	assert.equal(presetFor(82), 'balanced');
	assert.equal(presetFor(92), 'sharp');
	assert.equal(presetFor(70), null);
});

test('throwing storage does not break get/set', () => {
	const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
	const s = createSettings(CONFIG, bad);
	assert.equal(s.get().quality, 82);
	assert.equal(s.set({ quality: 70 }).quality, 70);
	assert.equal(s.get().quality, 70);
});

test('saved settings override config defaults; unknown keys ignored', () => {
	const store = memoryStorage({ [KEY]: JSON.stringify({ quality: 60, enabled: false, inspect: true, junk: 1 }) });
	const s = createSettings(CONFIG, store).get();
	assert.equal(s.quality, 60);
	assert.equal(s.enabled, false);
	assert.equal(s.preview, false);
	assert.equal('inspect' in s, false);
	assert.equal('junk' in s, false);
});

test('corrupt saved JSON falls back to defaults', () => {
	const s = createSettings(CONFIG, memoryStorage({ [KEY]: '{nope' })).get();
	assert.equal(s.quality, 82);
});

test('subscribe notifies with new settings and can unsubscribe', () => {
	const s = createSettings(CONFIG, memoryStorage());
	const seen = [];
	const off = s.subscribe((v) => seen.push(v.quality));
	s.set({ quality: 70 });
	off();
	s.set({ quality: 80 });
	assert.deepEqual(seen, [70]);
});

test('clampInt', () => {
	assert.equal(clampInt('50', 1, 100, 9), 50);
	assert.equal(clampInt('x', 1, 100, 9), 9);
	assert.equal(clampInt(0, 1, 100, 9), 1);
});
