import type { Client } from "@urql/core";
import { argsKey, makeGraphQLRequest } from "./request";
import type { RequireAtLeastOneFieldSet, UnArray } from "./utilTypes";

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

				return (input: Record<string, any>) => {
					return makeGraphQLRequest({
						queryName: prop as string,
						input,
						client: urqlClient,
						enableSubscription: availableSubscriptions.has(prop as string),
					});
				};
			},
		},
	) as QueryObject<Query>;

	return queryProxy;
}

type QueryObject<Q> = {
	[Key in keyof Q]: QueryField<Q[Key]>;
};

// export type Query = {
//   posts: () => Post[],
//   postsFiltered: (p?: {
// 	where?: PostsWhereInputArgument | null | undefined
//   }) => Post[],
//   user: (p: {
// 	id: ID
//   }) => User,
//   users: (p?: {
// 	limit?: Int | null | undefined,
// 	offset?: Int | null | undefined,
// 	orderBy?: UsersOrderInputArgument | null | undefined,
// 	where?: UsersWhereInputArgument | null | undefined
//   }) => User[]
// };

type QueryField<T> = T extends (p: infer QueryArgs) => infer QueryResponse
	? <
			Selected extends QueryArgs extends Record<string, any>
				? Selection<UnArray<NonNullable<QueryResponse>>> & {
						[argsKey]: QueryArgs;
					}
				: Selection<UnArray<NonNullable<QueryResponse>>>,
		>(
			s: Selected,
		) => Response<ApplySelection<QueryResponse, Selected>>
	: Response<T>;

// type QueryField<T> = T extends ScalarType
// 	? T
// 	: <S extends SelectionObjectType<Partial<Omit<UnArray<T>, "__typename">>>>(
// 			selection: S,
// 		) => T extends Array<any>
// 			? Response<ApplySelection<UnArray<T>, S>[]>
// 			: Response<ApplySelection<UnArray<T>, S>>;

type Selection<O> = RequireAtLeastOneFieldSet<{
	[Key in keyof O]: NonNullable<UnArray<O[Key]>> extends (p: infer P) => infer A
		? P extends Record<string, any>
			? Selection<UnArray<NonNullable<A>>> & { [argsKey]: P }
			: Selection<UnArray<NonNullable<A>>>
		: boolean;
}>;

// type ApplySelection<Object, Selection> = {
// 	[Key in keyof Selection & keyof Object]: Selection[Key] extends true | Record<any, any>
// 		? Object[Key] extends (p: infer P) => infer A
// 			? Object[Key] extends Array<any>
// 				? Array<ApplySelection<UnArray<Object[Key]>, Selection[Key]>>
// 				: ApplySelection<UnArray<Object[Key]>, Selection[Key]>
// 			: Object[Key]
// 		: never;
// };

type ApplySelection<Object, Selection> = {
	[Key in keyof Selection & keyof Object]: Object[Key] extends (
		p: infer P,
	) => infer A
		? ReturnType<Object[Key]> extends Array<any>
			? // ? Array<ApplySelection<UnArray<Object[Key]>, Selection[Key]>>
				Array<ApplySelection<UnArray<ReturnType<Object[Key]>>, Selection[Key]>>
			: ApplySelection<UnArray<Object[Key]>, Selection[Key]>
		: Object[Key];
};

export type Subscribeable<Data> = {
	subscribe: (subscription: (value: Data) => void) => () => void;
};

export type Response<Data> = {
	then: (onFulfilled: (value: Subscribeable<Data> & Data) => void) => void;
} & Subscribeable<Data | undefined>;
