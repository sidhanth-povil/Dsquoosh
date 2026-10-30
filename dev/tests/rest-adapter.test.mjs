import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMediaCollectionUpload } from '../../ds-webp-squoosh/assets/lib/rest-adapter.js';

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
