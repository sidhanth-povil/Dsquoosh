import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSize, detailText, footerText } from '../../ds-webp-squoosh/assets/lib/panel-rows.js';

const KB = 1024;
const MB = 1048576;
const done = (result) => ({ id: 1, name: 'a.jpg', size: result.origSize, status: 'done', result });
const converted = (origSize, webpSize) => done({ converted: true, reason: null, origSize, file: { size: webpSize } });
const kept = (reason) => done({ converted: false, reason, origSize: 5000, file: { size: 5000 } });

test('formatSize: 0 KB for nothing, whole KB below 1 MB (min 1 KB), one-decimal MB above', () => {
	assert.equal(formatSize(0), '0 KB');
	assert.equal(formatSize(10), '1 KB');
	assert.equal(formatSize(412 * KB), '412 KB');
	assert.equal(formatSize(3.1 * MB), '3.1 MB');
});

test('detailText: converted shows sizes and savings; reasons map to exact copy', () => {
	assert.equal(detailText(converted(3.1 * MB, 412 * KB)), '3.1 MB → 412 KB · −87%');
	assert.equal(detailText({ status: 'waiting' }), 'Waiting…');
	assert.equal(detailText({ status: 'converting' }), '');
	assert.equal(detailText(kept('animated')), 'Animated — uploaded as is');
	assert.equal(detailText(kept('larger')), 'WebP was larger — original uploaded');
	assert.equal(detailText(kept('failed')), "Couldn't convert — original uploaded");
	assert.equal(detailText(kept('server-no-webp')), 'Uploaded as original');
	for (const reason of ['disabled', 'web-format', 'not-image', 'undecodable', 'skipped-preview']) {
		assert.equal(detailText(kept(reason)), 'Uploaded as is');
	}
});

test('footerText: counts converted of done, sums savings; empty while none done', () => {
	assert.equal(footerText([{ status: 'converting' }]), '');
	const jobs = [converted(3 * MB, 1 * MB), converted(2 * MB, 1 * MB), kept('animated'), { status: 'waiting' }];
	assert.equal(footerText(jobs), '✓ 2 of 3 converted · saved 3.0 MB');
});
