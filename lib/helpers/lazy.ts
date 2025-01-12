export function lazy<T>(initializer: () => T): () => T {
	let value: T | undefined;
	let initialized = false;

	return () => {
		if (!initialized) {
			value = initializer();
			initialized = true;
		}
		return value!;
	};
}
