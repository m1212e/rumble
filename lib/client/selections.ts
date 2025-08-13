import type { User } from "../../example/src/generated-client/graphql";

/**
 * Can be used to transform a set of keys into a selector which can be chained
 */
export type Selector<Object extends Record<string, any>> = {
	[K in keyof Object]: Selector<{ [k in Exclude<keyof Object, K>]: Object[K] }>;
};

/**
 * Applies a selector to a response type, retaining only the selected fields
 */
export type ApplySelector<
	Object extends Record<string, any>,
	Selection extends Selector<Record<string, any>>,
> = {
	[K in Extract<keyof Object, keyof Selection>]: keyof Selection; //Object[K];
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

function ex<Object extends Record<string, any>>() {
	return <
		SelectionOutput extends Selector<Partial<Record<keyof Object, any>>>,
		SelectionFunction extends (
			s: Selector<Required<Object>>,
		) => SelectionOutput,
		QueryOutput extends ApplySelector<Required<Object>, SelectionOutput>,
	>(
		f: SelectionFunction,
	): QueryOutput => {
		return {} as any;
	};
}

const r = ex<User>()((s) => s.moodcol.name.posts);
r.somethingElse;
