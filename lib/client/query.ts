import type { Client } from "@urql/core";
import { makeGraphQLRequest } from "./request";
import type { UnArray } from "./utilTypes";

export function makeQuery<Query extends Record<string, any>>({
	urqlClient,
	availableSubscriptions,
}: {
	urqlClient: Client;
	availableSubscriptions: Set<string>;
}) {
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

				return (selection: Record<string, any>) => {
					return makeGraphQLRequest({
						queryName: prop as string,
						selection,
						client: urqlClient,
						enableSubscription: availableSubscriptions.has(prop as string),
					});
				};
			},
		},
	) as QueryObject<Query>;

	return queryProxy;
}

type ScalarTypeI = Date | string | number | boolean;
type ScalarType = ScalarTypeI | ScalarTypeI[];

type QueryObject<Q> = {
	[Key in keyof Q]: QueryField<Q[Key]>;
};

type QueryField<T> = T extends ScalarType
	? T
	: <S extends SelectionObjectType<Partial<Omit<UnArray<T>, "__typename">>>>(
			selection: S,
		) => T extends Array<any>
			? Response<ApplySelection<UnArray<T>, S>[]>
			: Response<ApplySelection<UnArray<T>, S>>;

type SelectionObjectType<O> = {
	[Key in keyof O]: NonNullable<UnArray<O[Key]>> extends ScalarType
		? boolean
		: SelectionObjectType<Partial<UnArray<O[Key]>>>;
};

type ApplySelection<Object, Selection> = {
	[Key in keyof Selection & keyof Object]: Selection[Key] extends
		| true
		| Record<any, any>
		? Object[Key] extends ScalarType
			? Object[Key]
			: Object[Key] extends Array<any>
				? Array<ApplySelection<UnArray<Object[Key]>, Selection[Key]>>
				: ApplySelection<UnArray<Object[Key]>, Selection[Key]>
		: never;
};

export type Subscribeable<Data> = {
	subscribe: (subscription: (value: Data) => void) => () => void;
};

export type Response<Data> = {
	then: (onFulfilled: (value: Subscribeable<Data> & Data) => void) => void;
} & Subscribeable<Data | undefined>;
