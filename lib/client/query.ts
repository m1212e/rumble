import type { Query } from "../../example/src/generated-client/graphql";
import type { makeSelector } from "./selections";

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

	type Selector<Type extends object> = ReturnType<typeof makeSelector<Type>>;
	type QueryFieldFunction<ReturnType extends object> = (p: {
		select: (s: Selector<ReturnType>) => Selector<ReturnType>;
	}) => ReturnType;

	type QueryObject = {
		[K in keyof NonArrayFields]: NonArrayFields[K] extends object
			? QueryFieldFunction<NonArrayFields[K]>
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
q.users({
	select: (s) => s,
});
