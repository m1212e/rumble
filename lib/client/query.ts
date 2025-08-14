import type { Query } from "../../example/src/generated-client/graphql";
import { type ApplySelector, makeSelector, type Selector } from "./selections";

type StripGraphqlStuffFromObject<T> = Required<{
	[K in keyof Omit<T, "__typename">]: NonNullable<Omit<T, "__typename">[K]>;
}>;

type NonArrayFields<T> = {
	[K in keyof T]: T[K] extends Array<any> ? T[K][number] : T[K];
};

type QueryFieldFunction<Object extends Record<string, any>> = <
	SelectionFunction extends (
		s: Selector<Required<Object>>,
	) => Selector<Record<string, any>>,
>(
	f: SelectionFunction,
) => Promise<ApplySelector<Object, ReturnType<SelectionFunction>>>;

export function makeQuery<Query extends Record<string, any>>() {
	type TransformedQuery = NonArrayFields<StripGraphqlStuffFromObject<Query>>;

	type QueryObject = {
		[K in keyof TransformedQuery]: TransformedQuery[K] extends object
			? QueryFieldFunction<StripGraphqlStuffFromObject<TransformedQuery[K]>>
			: undefined;
	};

	const queryProxy = new Proxy(
		{},
		{
			get: (target, prop) => {
				if (typeof prop === "symbol") {
					console.warn(
						"The selector seems to be have called with a symbol instead of a string, this is incorrect and cannot be handled",
					);
					return queryProxy;
				}

				const queryFunction = (fieldSelectorCallback: any) => {
					const { selectedFields, selectionProxy } = makeSelector();
					fieldSelectorCallback(selectionProxy);

					const req = (async () => {
						console.log(selectedFields);
						// TODO: perform query

						return {
							id: 10,
						};
					})();

					return req;
				};

				return queryFunction;
			},
		},
	) as QueryObject;

	return queryProxy;
}

const q = makeQuery<Query>();
const r = await q.users((s) => s.id.moodcol.posts((s) => s.content.id));
console.log(r.posts);
