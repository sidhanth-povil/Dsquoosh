// Plupload / wp.Uploader adapter: routes every image added to any uploader through
// `process` before core sees it (Add New, Library grid, media modal, Elementor).
const LOG = '[DS WebP Squoosh]';
// Above core's FilesAdded handlers (priority 0), which build the attachment tiles
// and call up.start() synchronously — they must never see a raw image.
const FILES_ADDED_PRIORITY = 100;
const POLL_MS = 250;
const POLL_TRIES = 120;
const DS_PARAMS = ['_ds_webp_quality', '_ds_orig_size'];

const nativeOf = (f) => (f.getNative && f.getNative()) || (f.getSource && f.getSource()) || null;
const isImage = (file) => String(file.type || '').startsWith('image/');

// Attachment id from an async-upload.php response: JSON `data.id` / `id`, or bare numeric text.
export function parseAttachmentId(response) {
	const text = String(response || '').trim();
	if (/^\d+$/.test(text)) return parseInt(text, 10);
	try {
		const parsed = JSON.parse(text);
		return Number((parsed && parsed.data && parsed.data.id) || (parsed && parsed.id)) || 0;
	} catch {
		return 0;
	}
}

function withDsParams(params, result) {
	const rest = Object.fromEntries(Object.entries(params || {}).filter(([k]) => !DS_PARAMS.includes(k)));
	if (!result || !result.converted) return rest;
	return { ...rest, _ds_webp_quality: result.quality, _ds_orig_size: result.origSize };
}

export function installPluploadAdapter({ process, onUploaded }) {
	const bound = new WeakSet(); // plupload instances
	const processed = new WeakSet(); // natives re-added after processing: never intercepted again
	const results = new WeakMap(); // re-added native File -> Result

	const isCandidate = (native) => !!native && isImage(native) && !processed.has(native);

	function readd(up, original, result) {
		const file = result ? result.file : original;
		processed.add(file);
		if (result) results.set(file, result);
		up.addFile(file);
	}

	function handle(up, native) {
		const serverSupportsWebp = !(up.settings && up.settings.webp_upload_error);
		Promise.resolve()
			.then(() => process(native, { serverSupportsWebp }))
			.then((result) => readd(up, native, result), (err) => {
				console.warn(LOG, `processing failed, uploading original ${native.name}:`, err);
				readd(up, native, null);
			})
			.catch((err) => {
				console.warn(LOG, `re-adding failed, uploading original ${native.name}:`, err);
				try {
					processed.add(native);
					up.addFile(native);
				} catch (again) {
					console.warn(LOG, `could not queue ${native.name}:`, again);
				}
			});
	}

	// Pulls the whole batch out synchronously and returns false so core's handlers never
	// see it; non-images re-add at once, each image once processed (converted or as-is).
	function onFilesAdded(up, added) {
		const natives = added.map(nativeOf);
		if (natives.some((n) => !n) || !natives.some(isCandidate)) return true;
		added.forEach((f) => up.removeFile(f)); // natives grabbed first: removeFile destroys wrappers
		natives.forEach((n) => (isCandidate(n) ? handle(up, n) : up.addFile(n)));
		return false;
	}

	function onBeforeUpload(up, file) {
		up.settings.multipart_params = withDsParams(up.settings.multipart_params, results.get(nativeOf(file)));
	}

	function onFileUploaded(up, file, res) {
		const result = results.get(nativeOf(file));
		if (!result) return;
		const id = parseAttachmentId(res && res.response);
		if (id) onUploaded(result, id);
		else if (result.converted) console.warn(LOG, 'no attachment id returned for', file.name);
	}

	function bindInstance(up) {
		if (!up || typeof up.bind !== 'function' || bound.has(up)) return;
		bound.add(up);
		up.bind('FilesAdded', onFilesAdded, null, FILES_ADDED_PRIORITY);
		up.bind('BeforeUpload', onBeforeUpload);
		up.bind('FileUploaded', onFileUploaded);
	}

	wrapWpUploader(bindInstance);
	bindStandalone(bindInstance);
}

// wp.Uploader.prototype.init runs (via Backbone initialize) for every uploader view
// with this.uploader ready. Wrapped at module evaluation, before DOM-ready builds any.
function wrapWpUploader(bindInstance) {
	const wrapped = new WeakSet();
	const tryWrap = () => {
		const Uploader = window.wp && window.wp.Uploader;
		if (typeof Uploader !== 'function') return false;
		['init', 'initialize'].forEach((method) => {
			const orig = Uploader.prototype[method];
			if (orig && wrapped.has(orig)) return;
			const wrapper = function (...args) {
				const out = orig ? orig.apply(this, args) : undefined;
				if (this && this.uploader) bindInstance(this.uploader);
				return out;
			};
			wrapped.add(wrapper);
			Uploader.prototype[method] = wrapper;
		});
		return true;
	};
	if (tryWrap()) return;
	let tries = 0;
	const timer = setInterval(() => {
		tries += 1;
		if (tryWrap() || tries > POLL_TRIES) clearInterval(timer);
	}, POLL_MS);
}

// media-new.php / media-upload.php build a bare plupload.Uploader as `window.uploader`
// in a jQuery ready callback. Ready callbacks run in registration order (core's first),
// so binding from one is deterministic; `load` stays as a fallback.
function bindStandalone(bindInstance) {
	const bind = () => {
		const view = window.uploader;
		if (!view) return;
		bindInstance(view.uploader || (view.view && view.view.uploader) || view);
	};
	if (typeof window.jQuery === 'function') window.jQuery(bind);
	window.addEventListener('load', bind);
}
