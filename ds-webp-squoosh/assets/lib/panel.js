// Floating WebP panel (bottom-right) + block-editor toolbar button. No innerHTML: names go via textContent.
import { STRINGS, buildRow, footerText } from './panel-rows.js';
import { buildSettings } from './panel-settings.js';

const AUTO_HIDE_MS = 4000;
const EDITOR_SLOTS = ['.editor-header__settings', '.edit-post-header__settings'];
const EDITOR_BODY = 'body.block-editor-page, body.site-editor-php';

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

const isShown = (node) => node.getClientRects().length > 0;

// wp-emoji swaps ⚡ for an <img> whenever a text node is *added*; editing a kept node's .data is invisible to it.
function liveText(node) {
	const text = document.createTextNode('');
	node.append(text);
	return (value) => { text.data = value; };
}

/** Calls fn at most once per animation frame for DOM mutations outside `ignore`. */
function observeDom(fn, ignore) {
	let frame = 0;
	const observer = new MutationObserver((records) => {
		if (frame || (ignore && records.every((r) => ignore.contains(r.target)))) return;
		frame = requestAnimationFrame(() => { frame = 0; fn(); });
	});
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
	return () => { observer.disconnect(); cancelAnimationFrame(frame); };
}

function buildShell(webpSupported) {
	const root = el('section', 'ds-webp-panel wp-exclude-emoji'); // wp-emoji's page-load parse skips us
	root.setAttribute('aria-label', STRINGS.title);
	const head = el('header', 'ds-webp-panel__head');
	const badge = el('button', 'ds-webp-panel__badge');
	badge.type = 'button';
	const caret = el('span', 'ds-webp-panel__caret');
	caret.setAttribute('aria-hidden', 'true');
	const setBadge = liveText(badge);
	badge.append(caret);
	head.append(el('strong', 'ds-webp-panel__title', STRINGS.title), badge);
	root.append(head);
	if (!webpSupported) root.append(el('p', 'ds-webp-panel__banner', STRINGS.banner));
	const list = el('ul', 'ds-webp-panel__list');
	list.setAttribute('aria-live', 'polite');
	const foot = el('div', 'ds-webp-panel__foot');
	return { root, badge, setBadge, caret, list, foot };
}

// Keyed row reconcile: only rows whose (frozen) job changed are rebuilt; thumb URLs die with their job.
function createRowRenderer(list) {
	const rows = new Map(); // id -> { job, node }
	const thumbs = new Map(); // id -> object URL
	const thumbUrl = (job) => {
		if (!thumbs.has(job.id)) thumbs.set(job.id, URL.createObjectURL(job.result.file));
		return thumbs.get(job.id);
	};
	function drop(id) {
		if (thumbs.has(id)) URL.revokeObjectURL(thumbs.get(id));
		thumbs.delete(id);
		rows.get(id)?.node.remove();
		rows.delete(id);
	}
	function render(jobs) {
		const ids = new Set(jobs.map((j) => j.id));
		[...rows.keys()].filter((id) => !ids.has(id)).forEach(drop);
		jobs.forEach((job) => {
			const prev = rows.get(job.id);
			if (prev && prev.job === job) return;
			const node = buildRow(job, thumbUrl);
			if (prev) prev.node.replaceWith(node); else list.append(node);
			rows.set(job.id, { job, node });
		});
	}
	return { render, destroy: () => [...rows.keys()].forEach(drop) };
}

// Visibility, expanded state and the 4 s linger timer. Hidden = no upload host, no jobs, not opened.
function createController(ui, form, jobs) {
	const listeners = new Set();
	const state = { forced: false, expanded: false, host: false, hovered: false, focused: false, timer: 0 };

	function armAutoHide(list) {
		clearTimeout(state.timer);
		const idle = list.every((j) => j.status === 'done');
		const lingering = list.length > 0 || state.forced;
		if (!idle || !lingering || state.hovered || state.focused || state.expanded) return;
		state.timer = setTimeout(() => {
			state.forced = false;
			if (jobs.snapshot().length) jobs.clear(); else refresh();
		}, AUTO_HIDE_MS);
	}

	function refresh() {
		const list = jobs.snapshot();
		const visible = state.host || state.forced || state.expanded || list.length > 0;
		ui.root.classList.toggle('is-visible', visible);
		if (!visible) Object.assign(state, { hovered: false, focused: false }); // hidden nodes get no leave/blur
		armAutoHide(list);
	}

	function setExpanded(expanded) {
		state.expanded = expanded;
		form.element.hidden = !expanded;
		ui.badge.setAttribute('aria-expanded', String(expanded));
		ui.caret.textContent = expanded ? '▴' : '▾';
		listeners.forEach((fn) => fn(expanded));
		refresh();
	}

	return { state, listeners, refresh, setExpanded };
}

function bindEvents(ui, ctl) {
	const { state } = ctl;
	const track = (key, value) => () => { state[key] = value; ctl.refresh(); };
	ui.badge.addEventListener('click', () => ctl.setExpanded(!state.expanded));
	ui.root.addEventListener('mouseenter', track('hovered', true));
	ui.root.addEventListener('mouseleave', track('hovered', false));
	ui.root.addEventListener('focusin', track('focused', true));
	ui.root.addEventListener('focusout', (e) => { state.focused = ui.root.contains(e.relatedTarget); ctl.refresh(); });
	ui.root.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape' || !state.expanded) return;
		e.stopPropagation(); // don't also close a media modal underneath
		ctl.setExpanded(false);
		ui.badge.focus();
	});
}

function buildApi(ui, form, ctl, teardown) {
	const open = (expanded = false) => {
		ctl.state.forced = true;
		ctl.setExpanded(expanded);
		if (expanded) form.element.querySelector('button, input')?.focus();
	};
	return {
		open,
		toggle() {
			if (!ctl.state.expanded) return open(true);
			ctl.state.forced = false;
			ctl.setExpanded(false);
		},
		isExpanded: () => ctl.state.expanded,
		subscribe(fn) { ctl.listeners.add(fn); return () => ctl.listeners.delete(fn); },
		destroy() {
			clearTimeout(ctl.state.timer);
			teardown();
			ctl.listeners.clear();
			ui.root.remove();
		},
	};
}

/**
 * @returns {{ open(expanded?: boolean): void, toggle(): void, isExpanded(): boolean,
 *   subscribe(fn: (expanded: boolean) => void): () => void, destroy(): void }}
 */
export function mountPanel({ settings, jobs, presets, presetFor, webpSupported = true, uploadHostSelector }) {
	const ui = buildShell(webpSupported);
	const form = buildSettings({ settings, presets, presetFor, webpSupported });
	ui.badge.setAttribute('aria-controls', form.element.id);
	ui.root.append(form.element, ui.list, ui.foot);
	document.body.append(ui.root);

	const rows = createRowRenderer(ui.list);
	const ctl = createController(ui, form, jobs);
	bindEvents(ui, ctl);
	const syncSettings = (s) => {
		const on = s.enabled && webpSupported;
		ui.setBadge(on ? STRINGS.badge(s.quality) : STRINGS.badgeOff);
		ui.badge.setAttribute('aria-label', on ? STRINGS.badgeLabel(s.quality) : STRINGS.badgeLabelOff);
		form.sync(s);
	};
	const renderJobs = (list) => {
		rows.render(list);
		ui.foot.textContent = footerText(list);
		ui.foot.hidden = !ui.foot.textContent;
		ctl.refresh();
	};
	const checkHost = () => {
		const host = [...document.querySelectorAll(uploadHostSelector)].some(isShown);
		if (host !== ctl.state.host) { ctl.state.host = host; ctl.refresh(); }
	};

	const unsubscribers = [settings.subscribe(syncSettings), jobs.subscribe(renderJobs), observeDom(checkHost, ui.root)];
	syncSettings(settings.get());
	ctl.setExpanded(false);
	renderJobs(jobs.snapshot());
	checkHost();

	return buildApi(ui, form, ctl, () => { unsubscribers.forEach((off) => off()); rows.destroy(); });
}

/** Block/site editor: a toolbar button that toggles the panel's settings. Survives React re-renders. */
export function mountEditorButton(panel, settings, webpSupported = true) {
	if (!document.querySelector(EDITOR_BODY)) return;
	const btn = el('button', 'ds-webp-editor-btn components-button wp-exclude-emoji');
	btn.type = 'button';
	btn.addEventListener('click', () => panel.toggle());
	const setText = liveText(btn);
	const label = (s) => setText(s.enabled && webpSupported ? STRINGS.editorBadge(s.quality) : STRINGS.editorBadgeOff);
	const expanded = (open) => btn.setAttribute('aria-expanded', String(open));
	settings.subscribe(label);
	panel.subscribe(expanded);
	label(settings.get());
	expanded(panel.isExpanded());

	const insert = () => {
		const slot = EDITOR_SLOTS.map((sel) => document.querySelector(sel)).find(Boolean);
		if (slot && btn.parentNode !== slot) slot.prepend(btn);
	};
	observeDom(insert, btn);
	insert();
}
