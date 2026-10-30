// Panel rows: job → row text (pure), plus DOM row builder. File names only ever go through textContent.
export const STRINGS = Object.freeze({
	title: 'WebP converter',
	switchLabel: 'Convert uploads to WebP',
	quality: 'Quality',
	presets: Object.freeze({ smallest: 'Smallest', balanced: 'Balanced', sharp: 'Sharp' }),
	sliderLabel: 'WebP quality',
	keepOriginal: 'Keep original copy',
	preview: 'Preview each image before upload',
	banner: "This server can't process WebP — uploading originals",
	waiting: 'Waiting…',
	converting: 'Converting…',
	animated: 'Animated — uploaded as is',
	larger: 'WebP was larger — original uploaded',
	failed: "Couldn't convert — original uploaded",
	serverNoWebp: 'Uploaded as original',
	asIs: 'Uploaded as is',
	badge: (q) => `⚡ ${q}%`,
	badgeOff: '⚡ off',
	badgeLabel: (q) => `WebP settings, quality ${q}%`,
	badgeLabelOff: 'WebP conversion off',
	editorBadge: (q) => `⚡ WebP · ${q}%`,
	editorBadgeOff: '⚡ WebP · off',
	footer: (n, total, size) => `✓ ${n} of ${total} converted · saved ${size}`,
});

const MB = 1048576;
const KB = 1024;
const REASON_TEXT = Object.freeze({
	animated: STRINGS.animated,
	larger: STRINGS.larger,
	failed: STRINGS.failed,
	'server-no-webp': STRINGS.serverNoWebp,
});

export function formatSize(bytes) {
	if (bytes <= 0) return '0 KB';
	if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / KB))} KB`;
}

const savedBytes = (r) => r.origSize - r.file.size;

/** Row detail line for a job; '' while converting (the progress bar says it). */
export function detailText(job) {
	if (job.status === 'waiting') return STRINGS.waiting;
	if (job.status !== 'done') return '';
	const r = job.result;
	if (!r.converted) return REASON_TEXT[r.reason] || STRINGS.asIs;
	const pct = Math.round((savedBytes(r) / r.origSize) * 100);
	return `${formatSize(r.origSize)} → ${formatSize(r.file.size)} · −${pct}%`;
}

/** Footer summary over finished jobs, or '' while none is done. */
export function footerText(jobs) {
	const done = jobs.filter((j) => j.status === 'done');
	if (!done.length) return '';
	const converted = done.filter((j) => j.result.converted);
	const saved = converted.reduce((sum, j) => sum + savedBytes(j.result), 0);
	return STRINGS.footer(converted.length, done.length, formatSize(saved));
}

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

function extension(name) {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : '';
}

// Converted files show their WebP; thumbUrl(job) owns the object URL lifecycle.
function buildThumb(job, thumbUrl) {
	if (job.status === 'done' && job.result.converted) {
		const img = el('img', 'ds-webp-panel__thumb');
		img.alt = '';
		img.src = thumbUrl(job);
		return img;
	}
	const tile = el('span', 'ds-webp-panel__thumb', extension(job.name));
	tile.setAttribute('aria-hidden', 'true');
	return tile;
}

function statusMark(job) {
	if (job.status === 'waiting') return '·';
	if (job.status !== 'done') return '';
	return job.result.converted ? '✓' : '–';
}

function buildBody(job) {
	const body = el('div', 'ds-webp-panel__file');
	body.append(el('div', 'ds-webp-panel__name', job.name));
	if (job.status === 'converting') {
		const bar = el('div', 'ds-webp-panel__bar');
		bar.setAttribute('role', 'progressbar');
		bar.setAttribute('aria-label', STRINGS.converting);
		bar.append(el('i'));
		body.append(bar);
	} else {
		body.append(el('div', 'ds-webp-panel__detail', detailText(job)));
	}
	return body;
}

export function buildRow(job, thumbUrl) {
	const row = el('li', 'ds-webp-panel__row');
	row.dataset.status = job.status;
	if (job.result) row.dataset.reason = job.result.reason || 'converted';
	const mark = el('span', 'ds-webp-panel__mark', statusMark(job));
	mark.setAttribute('aria-hidden', 'true');
	row.append(buildThumb(job, thumbUrl), buildBody(job), mark);
	return row;
}
