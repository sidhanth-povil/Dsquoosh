// Block editor adapter: an apiFetch middleware that routes images POSTed to the REST
// media collection (`uploadToServer` in @wordpress/media-utils) through `process`.
// Sub-size sideloads (/wp/v2/media/{id}/sideload) and every other request pass untouched.
const LOG = '[DS WebP Squoosh]';
const MEDIA_COLLECTION = /^\/?wp\/v2\/media\/?$/;

// Tag checks instead of instanceof: a File dropped into the editor iframe comes from another realm.
const tagOf = (value) => Object.prototype.toString.call(value);
const isFile = (value) => tagOf(value) === '[object File]';

// REST route of `path` ("/wp/v2/media?…") or `url` (".../wp-json/wp/v2/media?…" or "?rest_route=/wp/v2/media").
function routeOf(options) {
	if (typeof options.path === 'string') return options.path.split('?')[0];
	if (typeof options.url !== 'string') return '';
	const url = new URL(options.url, 'http://localhost');
	return url.searchParams.get('rest_route') || url.pathname.replace(/^.*?\/wp-json(?=\/)/, '');
}

export function isMediaCollectionUpload(options) {
	if (!options || String(options.method || 'GET').toUpperCase() !== 'POST') return false;
	return MEDIA_COLLECTION.test(routeOf(options));
}

// The image File under `file` when this request is one we convert, else null.
function uploadedImage(options) {
	if (!isMediaCollectionUpload(options) || tagOf(options.body) !== '[object FormData]') return null;
	const file = options.body.get('file');
	return isFile(file) && String(file.type || '').startsWith('image/') ? file : null;
}

// New FormData in original order, `original` swapped for the result file, DS fields when converted.
function rebuildBody(body, original, result) {
	const out = new FormData();
	for (const [key, value] of body.entries()) {
		if (value === original) out.append(key, result.file, result.file.name);
		else if (isFile(value)) out.append(key, value, value.name);
		else out.append(key, value);
	}
	if (result.converted) {
		out.append('_ds_webp_quality', String(result.quality));
		out.append('_ds_orig_size', String(result.origSize));
	}
	return out;
}

// Options to send instead (null = leave the request alone) plus the Result behind them.
async function prepare(options, process) {
	const original = uploadedImage(options);
	if (!original) return null;
	const result = await process(original);
	return { options: { ...options, body: rebuildBody(options.body, original, result) }, result };
}

function notifyUploaded(response, result, onUploaded) {
	// parse:false hands back a raw Response: no id to read, so no vault.
	if (!response || typeof response.id !== 'number') return;
	try {
		onUploaded(result, response.id);
	} catch (err) {
		console.warn(LOG, 'post-upload step failed:', err);
	}
}

// apiFetch's nonce refresh re-runs the whole chain with the original options: one
// conversion per original File (forgotten on rejection so a retry can try again).
function memoiseByFile(process) {
	const results = new WeakMap();
	return (file) => {
		if (!results.has(file)) {
			const pending = Promise.resolve().then(() => process(file));
			results.set(file, pending);
			pending.catch(() => results.delete(file));
		}
		return results.get(file);
	};
}

export function installRestAdapter({ apiFetch, process, onUploaded }) {
	const processOnce = memoiseByFile(process);
	apiFetch.use(async (options, next) => {
		let prepared;
		try {
			prepared = await prepare(options, processOnce);
		} catch (err) {
			console.warn(LOG, 'REST upload adapter failed, sending the request unchanged:', err);
			return next(options);
		}
		if (!prepared) return next(options);
		const response = await next(prepared.options); // upload errors propagate as-is
		notifyUploaded(response, prepared.result, onUploaded);
		return response;
	});
}
