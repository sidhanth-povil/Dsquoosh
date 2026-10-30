// Shared upload pipeline: decides, converts and size-checks one file. No DOM/Worker access.
const LOG = '[DS WebP Squoosh]';

function webpName(name) {
	const dot = name.lastIndexOf('.');
	return `${dot > 0 ? name.slice(0, dot) : name}.webp`;
}

const result = (original, file, reason, quality) => Object.freeze({
	original,
	file,
	converted: reason === null,
	reason,
	quality: reason === null ? quality : null,
	origSize: original.size,
});

const keep = (original, reason) => result(original, original, reason, null);

function emit(onStage, stage, original, res) {
	if (!onStage) return;
	try {
		onStage(stage, original, res);
	} catch (err) {
		console.warn(LOG, 'onStage handler failed:', err);
	}
}

// Returns { blob, quality } to upload, or null when the user skipped in the preview.
async function encode(original, settings, ctx) {
	emit(ctx.onStage, 'converting', original);
	if (settings.preview && ctx.preview) return ctx.preview(original, settings.quality);
	return { blob: await ctx.convert(original, settings.quality), quality: settings.quality };
}

async function decide(original, settings, ctx) {
	if (!settings.enabled) return keep(original, 'disabled');
	if (!ctx.serverSupportsWebp) return keep(original, 'server-no-webp');
	const verdict = await ctx.classify(original);
	if (!verdict.convert) return keep(original, verdict.reason);
	const encoded = await encode(original, settings, ctx);
	if (!encoded) return keep(original, 'skipped-preview');
	if (encoded.blob.size >= original.size) return keep(original, 'larger');
	const file = new File([encoded.blob], webpName(original.name), { type: 'image/webp', lastModified: original.lastModified });
	return result(original, file, null, encoded.quality);
}

export async function processFile(original, ctx) {
	const settings = { ...ctx.settings };
	let res;
	try {
		res = await decide(original, settings, ctx);
	} catch (err) {
		console.warn(LOG, `conversion failed for ${original.name}:`, err);
		res = keep(original, 'failed');
	}
	emit(ctx.onStage, 'done', original, res);
	return res;
}
