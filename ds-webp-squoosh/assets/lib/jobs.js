// Job store for the panel UI: immutable snapshots + subscribers.
export function createJobStore() {
	let jobs = Object.freeze([]);
	let nextId = 1;
	const listeners = new Set();

	function commit(next) {
		jobs = Object.freeze(next);
		listeners.forEach((fn) => fn(jobs));
	}

	return {
		add(name, size) {
			const id = nextId++;
			commit([...jobs, Object.freeze({ id, name, size, status: 'waiting', result: null })]);
			return id;
		},
		update(id, patch) {
			if (!jobs.some((j) => j.id === id)) return;
			commit(jobs.map((j) => (j.id === id ? Object.freeze({ ...j, ...patch, id }) : j)));
		},
		snapshot: () => jobs,
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		clear() {
			commit([]);
		},
	};
}
