// Settings store: quality presets + persistence. Pure ES module (storage injected).
export const PRESETS = Object.freeze({ smallest: 60, balanced: 82, sharp: 92 });
const STORAGE_KEY = 'dsWebpSettings';

export function presetFor(quality) {
	const hit = Object.entries(PRESETS).find(([, q]) => q === quality);
	return hit ? hit[0] : null;
}

export function clampInt(value, min, max, fallback) {
	const n = parseInt(value, 10);
	if (Number.isNaN(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function normalize(candidate, base) {
	return Object.freeze({
		enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : base.enabled,
		quality: clampInt(candidate.quality, 1, 100, base.quality),
		keepOriginal: typeof candidate.keepOriginal === 'boolean' ? candidate.keepOriginal : base.keepOriginal,
		preview: typeof candidate.preview === 'boolean' ? candidate.preview : base.preview,
	});
}

function load(storage, base) {
	try {
		const raw = storage.getItem(STORAGE_KEY);
		const saved = raw ? JSON.parse(raw) : null;
		return saved && typeof saved === 'object' ? normalize(saved, base) : base;
	} catch {
		return base;
	}
}

function save(storage, settings) {
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Storage unavailable (private mode, quota): settings stay in memory only.
	}
}

export function createSettings(config, storage = globalThis.localStorage) {
	const defaults = Object.freeze({
		enabled: true,
		quality: clampInt(config.defaultQuality, 1, 100, PRESETS.balanced),
		keepOriginal: !!config.defaultBackup,
		preview: false,
	});
	let current = load(storage, defaults);
	const listeners = new Set();

	return {
		get: () => current,
		set(partial) {
			current = normalize(partial, current);
			save(storage, current);
			listeners.forEach((fn) => fn(current));
			return current;
		},
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
}
