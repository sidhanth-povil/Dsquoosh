import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMediaCollectionUpload, installRestAdapter } from '../../ds-webp-squoosh/assets/lib/rest-adapter.js';

const post = (extra) => ({ method: 'POST', ...extra });

test('media collection POST via path, url, or rest_route matches', () => {
	assert.equal(isMediaCollectionUpload(post({ path: '/wp/v2/media?_embed=wp:featuredmedia' })), true);
	assert.equal(isMediaCollectionUpload(post({ path: '/wp/v2/media' })), true);
	assert.equal(isMediaCollectionUpload(post({ path: 'wp/v2/media/' })), true);
	assert.equal(isMediaCollectionUpload(post({ url: 'https://site.test/wp-json/wp/v2/media?_locale=user' })), true);
	assert.equal(isMediaCollectionUpload(post({ url: 'https://site.test/?rest_route=/wp/v2/media&_locale=user' })), true);
	assert.equal(isMediaCollectionUpload({ method: 'post', path: '/wp/v2/media' }), true);
});

test('item, sideload, edit, other routes and non-POST do not match', () => {
	assert.equal(isMediaCollectionUpload(post({ path: '/wp/v2/media/123' })), false);
	assert.equal(isMediaCollectionUpload(post({ path: '/wp/v2/media/123/sideload' })), false);
	assert.equal(isMediaCollectionUpload(post({ path: '/wp/v2/media/123/edit' })), false);
	assert.equal(isMediaCollectionUpload(post({ url: 'https://site.test/?rest_route=/wp/v2/media/9/sideload' })), false);
	assert.equal(isMediaCollectionUpload(post({ path: '/wp/v2/posts' })), false);
	assert.equal(isMediaCollectionUpload(post({ path: '/my/v1/wp/v2/media' })), false);
	assert.equal(isMediaCollectionUpload({ path: '/wp/v2/media' }), false);
	assert.equal(isMediaCollectionUpload({ method: 'GET', path: '/wp/v2/media' }), false);
	assert.equal(isMediaCollectionUpload(post({})), false);
});

/* ---- middleware ---- */

const jpg = () => new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });
const webp = new File([new Uint8Array(10)], 'photo.webp', { type: 'image/webp' });
const converted = (original) => Object.freeze({ original, file: webp, converted: true, reason: null, quality: 82, origSize: 100 });
const kept = (original) => Object.freeze({ original, file: original, converted: false, reason: 'larger', quality: null, origSize: 100 });

function setup({ process = async (f) => converted(f), onUploaded = () => {} } = {}) {
	let middleware;
	const calls = { process: 0, uploaded: [] };
	installRestAdapter({
		apiFetch: { use: (m) => { middleware = m; } },
		process: (f) => { calls.process += 1; return process(f); },
		onUploaded: (result, id) => { calls.uploaded.push([result, id]); onUploaded(result, id); },
	});
	return { run: (options, next) => middleware(options, next), calls };
}

function uploadOptions(file, extra = []) {
	const body = new FormData();
	body.append('file', file, file.name);
	extra.forEach(([k, v, name]) => (name ? body.append(k, v, name) : body.append(k, v)));
	return { path: '/wp/v2/media?_embed=wp:featuredmedia', method: 'POST', body };
}

const entries = (fd) => [...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]);

test('same options twice (nonce retry) → process once, both get the converted body', async () => {
	const { run, calls } = setup();
	const options = uploadOptions(jpg());
	const sent = [];
	const next = async (o) => { sent.push(o); return { id: 7 }; };
	await run(options, next);
	await run(options, next);
	assert.equal(calls.process, 1);
	assert.equal(sent.length, 2);
	sent.forEach((o) => assert.equal(o.body.get('file').name, 'photo.webp'));
	assert.notEqual(sent[0].body, options.body);
});

test('a rejected process is forgotten so the next attempt processes again', async (t) => {
	t.mock.method(console, 'warn', () => {});
	let fail = true;
	const { run, calls } = setup({ process: async (f) => { if (fail) throw new Error('boom'); return converted(f); } });
	const options = uploadOptions(jpg());
	await run(options, async () => ({ id: 1 }));
	fail = false;
	let sent;
	await run(options, async (o) => { sent = o; return { id: 2 }; });
	assert.equal(calls.process, 2);
	assert.equal(sent.body.get('file').name, 'photo.webp');
});

test('non-image FormData and non-matching requests pass through untouched', async () => {
	const { run, calls } = setup();
	const pdf = uploadOptions(new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
	const sideload = { ...uploadOptions(jpg()), path: '/wp/v2/media/5/sideload' };
	const json = { path: '/wp/v2/media', method: 'POST', data: { title: 'x' } };
	for (const options of [pdf, sideload, json]) {
		let seen;
		await run(options, async (o) => { seen = o; return { id: 3 }; });
		assert.equal(seen, options);
	}
	assert.equal(calls.process, 0);
	assert.equal(calls.uploaded.length, 0);
});

test('process throwing → next(options) unchanged and a [DS WebP Squoosh] warning', async (t) => {
	const warn = t.mock.method(console, 'warn', () => {});
	const { run, calls } = setup({ process: async () => { throw new Error('boom'); } });
	const options = uploadOptions(jpg());
	let seen;
	await run(options, async (o) => { seen = o; return { id: 4 }; });
	assert.equal(seen, options);
	assert.equal(warn.mock.callCount(), 1);
	assert.match(String(warn.mock.calls[0].arguments[0]), /^\[DS WebP Squoosh\]/);
	assert.equal(calls.uploaded.length, 0);
});

test('errors from next propagate unchanged, no retry', async () => {
	const { run } = setup();
	const err = new Error('rest_upload_failed');
	let sends = 0;
	await assert.rejects(run(uploadOptions(jpg()), async () => { sends += 1; throw err; }), (e) => e === err);
	assert.equal(sends, 1);
});

test('onUploaded only for a numeric id; parse:false Response and missing id skip it', async () => {
	const { run, calls } = setup();
	const raw = new Response('{}');
	assert.equal(await run({ ...uploadOptions(jpg()), parse: false }, async () => raw), raw);
	await run(uploadOptions(jpg()), async () => ({ title: 'no id' }));
	assert.equal(calls.uploaded.length, 0);
	const response = { id: 9 };
	assert.equal(await run(uploadOptions(jpg()), async () => response), response);
	assert.equal(calls.uploaded.length, 1);
	assert.equal(calls.uploaded[0][1], 9);
});

test('onUploaded throwing does not affect the returned response', async (t) => {
	t.mock.method(console, 'warn', () => {});
	const { run } = setup({ onUploaded: () => { throw new Error('vault down'); } });
	const response = { id: 11 };
	assert.equal(await run(uploadOptions(jpg()), async () => response), response);
});

test('rebuild keeps entry order + filenames; DS fields only when converted', async () => {
	const extra = [['post', '12'], ['attachment', new File(['a'], 'notes.txt', { type: 'text/plain' }), 'notes.txt'], ['caption', 'hi']];
	const conv = setup();
	let sent;
	await conv.run(uploadOptions(jpg(), extra), async (o) => { sent = o; return { id: 1 }; });
	assert.deepEqual(entries(sent.body), [['file', 'photo.webp'], ['post', '12'], ['attachment', 'notes.txt'], ['caption', 'hi'],
		['_ds_webp_quality', '82'], ['_ds_orig_size', '100']]);
	assert.equal(sent.method, 'POST');
	assert.equal(sent.path, '/wp/v2/media?_embed=wp:featuredmedia');

	const keep = setup({ process: async (f) => kept(f) });
	await keep.run(uploadOptions(jpg(), extra), async (o) => { sent = o; return { id: 1 }; });
	assert.deepEqual(entries(sent.body), [['file', 'photo.jpg'], ['post', '12'], ['attachment', 'notes.txt'], ['caption', 'hi']]);
});
