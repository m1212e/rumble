import type { Query } from "../../example/src/generated-client/graphql";
import type { makeSelector, ApplySelector, Selector } from "./selections";

type StripGraphqlStuffFromObject<T> = Required<{
	[K in keyof Omit<T, "__typename">]: NonNullable<Omit<T, "__typename">[K]>;
}>;

export function makeQuery<Query extends Record<string, any>>() {
	type NonNullableFields = StripGraphqlStuffFromObject<Query>;
	type NonArrayFields = {
		[K in keyof NonNullableFields]: NonNullableFields[K] extends Array<any>
			? NonNullableFields[K][number]
			: NonNullableFields[K];
	};

	type QueryFieldFunction<
		Object extends Record<string, any>,
		SelectionOutput extends Selector<
			Partial<Record<keyof Object, any>>
		> = Selector<Partial<Record<keyof Object, any>>>,
	> = (
		f: (s: Selector<Object>) => SelectionOutput,
	) => ApplySelector<Object, SelectionOutput>;

	type QueryObject = {
		[K in keyof NonArrayFields]: NonArrayFields[K] extends object
			? QueryFieldFunction<StripGraphqlStuffFromObject<NonArrayFields[K]>>
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
r.