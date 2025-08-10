import type Mobius from "graphql-mobius";
import { readable } from "svelte/store";

export function mobiusWrapper<S extends string, M extends Mobius<S>>(
	mobius: M,
) {
	return {
		mutate: mobius.mutate,
		query: async <P extends Parameters<M["query"]>[0]>(params: P) => {
			const queryResult = await mobius.query(params);

			if (!queryResult) {
				throw new Error(`Query result is not a value: ${params}`);
			}

			const results = readable(queryResult, (set) => {
				(async () => {
					try {
						const sub = await mobius.subscription(params);
                        sub.
					} catch (error) {}
				})();

				// set(new Date());

				// const interval = setInterval(() => {
				// 	set(new Date());
				// }, 1000);

				// return () => clearInterval(interval);
			});

			return results;
		},
	};
}
