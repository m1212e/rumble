/**
 * Can be used to transform a set of keys into a selector which can be chained
 */
export type Selector<Object extends Record<string, any>> = {
	[K in keyof Object]: Selector<{ [k in Exclude<keyof Object, K>]: Object[K] }>;
};

/**
 * Applies a selector to a response type, retaining only the selected fields
 */
export type Selected<
	Object extends Record<string, any>,
	Selection extends Selector<Record<string, any>>,
	Response extends Record<keyof Object, any>,
> = {
	[K in Exclude<keyof Object, keyof Selection>]: Response[K];
};

export function makeSelector<Object extends Record<string, any>>() {
	const selectedkeys: (keyof Object)[] = [];
	const selectionProxy = new Proxy(
		{},
		{
			get: (target, prop) => {
				if (typeof prop === "symbol") {
					console.warn(
						"The selector seems to be have called with a symbol instead of a string, this is incorrect and cannot be handled",
					);
					return selectionProxy;
				}

				selectedkeys.push(prop as keyof Object);
				return selectionProxy;
			},
		},
	) as Selector<Object>;

	return { selectionProxy, selectedkeys };
}
