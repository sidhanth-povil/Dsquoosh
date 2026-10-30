import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from '../../ds-webp-squoosh/assets/lib/jobs.js';

test('job store: add/update give new frozen snapshots and notify subscribers', () => {
	const store = createJobStore();
	const seen = [];
	const unsubscribe = store.subscribe((jobs) => seen.push(jobs));

	const empty = store.snapshot();
	assert.equal(store.snapshot(), empty, 'stable instance until change');
	const id = store.add('a.jpg', 1000);
	const s1 = store.snapshot();
	assert.notEqual(s1, empty);
	assert.ok(Object.isFrozen(s1) && Object.isFrozen(s1[0]));
	assert.deepEqual(s1[0], { id, name: 'a.jpg', size: 1000, status: 'waiting', result: null });

	store.update(id, { status: 'converting' });
	const s2 = store.snapshot();
	assert.equal(s1[0].status, 'waiting', 'old snapshot untouched');
	assert.equal(s2[0].status, 'converting');
	assert.equal(s2[0].name, 'a.jpg');
	assert.equal(seen.length, 2);
	assert.equal(seen[1], s2);

	store.update(999, { status: 'done' });
	assert.equal(store.snapshot(), s2, 'unknown id is a no-op');
	assert.equal(seen.length, 2);

	assert.notEqual(store.add('b.png', 5), id, 'ids are unique');
	store.clear();
	assert.equal(store.snapshot().length, 0);
	unsubscribe();
	store.add('c.png', 1);
	assert.equal(seen.length, 4);
});
