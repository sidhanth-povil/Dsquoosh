// FIFO concurrency limiter: run(fn) starts fn once fewer than `max` tasks are in flight.
export function createLimiter(max) {
	let active = 0;
	const waiting = [];
	function next() {
		if (active >= max || !waiting.length) return;
		active += 1;
		const { fn, resolve, reject } = waiting.shift();
		Promise.resolve().then(fn).then(resolve, reject).finally(() => { active -= 1; next(); });
	}
	return function run(fn) {
		return new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
	};
}
