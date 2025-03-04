/**
 * Creates a lazily initialized function.
 *
 * The returned function will call the initializer function on its first call and
 * store the result. On subsequent calls, it will return the stored result.
 *
 * @param initializer The function to be called for initialization.
 * @returns A function that calls the initializer function on its first call and
 *          returns the stored result on subsequent calls.
 */
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
