import type { Query } from "../../example/src/generated-client/graphql";
import type { ApplySelector, makeSelector, Selector } from "./selections";

type StripGraphqlStuffFromObject<T> = Required<{
	[K in keyof Omit<T, "__typename">]: NonNullable<Omit<T, "__typename">[K]>;
}>;

type NonArrayFields<T> = {
	[K in keyof T]: T[K] extends Array<any> ? T[K][number] : T[K];
};

type QueryFieldFunction<Object extends Record<string, any>> = <
	SelectionFunction extends (
		s: Selector<Required<Object>>,
	) => Selector<Partial<Record<string, any>>>,
>(
	f: SelectionFunction,
) => ApplySelector<Object, ReturnType<SelectionFunction>>;

// function field<Object extends Record<string, any>>() {
// 	return <
// 		SelectionFunction extends (
// 			s: Selector<Required<Object>>,
// 		) => Selector<Partial<Record<string, any>>>,
// 	>(
// 		f: SelectionFunction,
// 	): ApplySelector<Object, ReturnType<SelectionFunction>> => {
// 		return {} as any;
// 	};
// }

// const r = ex<User>()((s) => s.moodcol.name.id);

export function makeQuery<Query extends Record<string, any>>() {
	type TransformedQuery = NonArrayFields<StripGraphqlStuffFromObject<Query>>;

	type QueryObject = {
		[K in keyof TransformedQuery]: TransformedQuery[K] extends object
			? QueryFieldFunction<StripGraphqlStuffFromObject<TransformedQuery[K]>>
			: undefined;
	};

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

				// selectedkeys.push(prop as keyof Object);
				return selectionProxy;
			},
		},
	) as QueryObject;

	return selectionProxy;
}

const q = makeQuery<Query>();
const r = q.users((s) => s.id.moodcol.name);
