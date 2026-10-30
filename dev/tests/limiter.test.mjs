import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../../ds-webp-squoosh/assets/lib/limiter.js';

test('10 tasks never exceed 3 in flight and start in FIFO order', async () => {
	const run = createLimiter(3);
	let inFlight = 0;
	let peak = 0;
	const started = [];
	const task = (i) => run(async () => {
		started.push(i);
		peak = Math.max(peak, ++inFlight);
		await new Promise((r) => setTimeout(r, 5));
		inFlight -= 1;
		return i;
	});
	const out = await Promise.all(Array.from({ length: 10 }, (_, i) => task(i)));
	assert.equal(peak, 3);
	assert.deepEqual(started, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a rejecting task frees its slot', async () => {
	const run = createLimiter(1);
	await assert.rejects(run(async () => { throw new Error('x'); }), /x/);
	assert.equal(await run(async () => 'ok'), 'ok');
});
