// Panel settings section: switch, preset radios, quality slider, two checkboxes — all via settings.set.
import { STRINGS } from './panel-rows.js';

let uid = 0;

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

function buildSwitch(settings, webpSupported) {
	const sw = el('button', 'ds-webp-panel__switch');
	sw.type = 'button';
	sw.setAttribute('role', 'switch');
	sw.disabled = !webpSupported;
	sw.append(el('span', 'ds-webp-panel__switch-label', STRINGS.switchLabel), el('span', 'ds-webp-panel__track'));
	sw.addEventListener('click', () => settings.set({ enabled: !settings.get().enabled }));
	return sw;
}

function buildPresets(settings, presets, name) {
	const group = el('div', 'ds-webp-panel__presets');
	group.setAttribute('role', 'radiogroup');
	group.setAttribute('aria-label', STRINGS.quality);
	const radios = Object.entries(presets).map(([key, quality]) => {
		const label = el('label', 'ds-webp-panel__preset');
		const radio = el('input');
		Object.assign(radio, { type: 'radio', name, value: key });
		radio.addEventListener('change', () => settings.set({ quality }));
		label.append(radio, el('span', '', STRINGS.presets[key] || key));
		group.append(label);
		return radio;
	});
	return { group, radios };
}

function buildSlider(settings) {
	const range = el('input', 'ds-webp-panel__range');
	Object.assign(range, { type: 'range', min: 1, max: 100, step: 1 });
	range.setAttribute('aria-label', STRINGS.sliderLabel);
	range.addEventListener('input', () => settings.set({ quality: Number(range.value) }));
	return range;
}

function buildCheckbox(settings, key, text) {
	const label = el('label', 'ds-webp-panel__check');
	const box = el('input');
	box.type = 'checkbox';
	box.addEventListener('change', () => settings.set({ [key]: box.checked }));
	label.append(box, el('span', '', text));
	return { label, box };
}

function buildQuality(nodes) {
	const wrap = el('div', 'ds-webp-panel__quality');
	const head = el('div', 'ds-webp-panel__qhead');
	head.append(el('span', 'ds-webp-panel__muted', STRINGS.quality), nodes.qValue);
	wrap.append(head, nodes.presets.group, nodes.range);
	return wrap;
}

/** Builds the settings section; returns { element, sync(state) }. */
export function buildSettings({ settings, presets, presetFor, webpSupported }) {
	const id = `ds-webp-settings-${++uid}`;
	const nodes = {
		sw: buildSwitch(settings, webpSupported),
		qValue: el('strong', 'ds-webp-panel__qvalue'),
		presets: buildPresets(settings, presets, `${id}-preset`),
		range: buildSlider(settings),
		keep: buildCheckbox(settings, 'keepOriginal', STRINGS.keepOriginal),
		preview: buildCheckbox(settings, 'preview', STRINGS.preview),
	};
	const element = el('div', 'ds-webp-panel__settings');
	element.id = id;
	const checks = el('div', 'ds-webp-panel__checks');
	checks.append(nodes.keep.label, nodes.preview.label);
	element.append(nodes.sw, buildQuality(nodes), checks);

	function sync(state) {
		nodes.sw.setAttribute('aria-checked', String(state.enabled && webpSupported));
		nodes.qValue.textContent = `${state.quality}%`;
		const preset = presetFor(state.quality);
		nodes.presets.radios.forEach((r) => { r.checked = r.value === preset; });
		if (Number(nodes.range.value) !== state.quality) nodes.range.value = String(state.quality);
		nodes.range.style.setProperty('--ds-fill', `${state.quality}%`);
		nodes.keep.box.checked = state.keepOriginal;
		nodes.preview.box.checked = state.preview;
		element.classList.toggle('is-off', !state.enabled);
	}
	return { element, sync };
}
