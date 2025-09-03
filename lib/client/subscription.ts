import type { Client } from "@urql/core";
import { argsKey, makeGraphQLSubscription } from "./request";
import type { RequireAtLeastOneFieldSet, UnArray } from "./utilTypes";

export function makeSubscription<Subscription extends Record<string, any>>({
	urqlClient,
}: {
	urqlClient: Client;
}) {
	return new Proxy(
		{},
		{
			get: (target, prop) => {
				return (input: Record<string, any>) => {
					return makeGraphQLSubscription({
						subscriptionName: prop as string,
						input,
						client: urqlClient,
					});
				};
			},
		},
	) as SubscriptionObject<Subscription>;
}

//TODO: DRY up these types with the live query ones

export type SubscriptionObject<Q> = {
	[Key in keyof Q]: QueryField<Q[Key]>;
};

type QueryField<T> = T extends (p: infer QueryArgs) => infer QueryResponse
	? <
			Selected extends QueryArgs extends Record<string, any>
				? Selection<UnArray<NonNullable<QueryResponse>>> & {
						[argsKey]: QueryArgs;
					}
				: Selection<UnArray<NonNullable<QueryResponse>>>,
		>(
			s: Selected,
		) => QueryResponse extends null
			? Subscribeable<
					NonNullable<QueryResponse> extends Array<any>
						? ApplySelection<UnArray<NonNullable<QueryResponse>>, Selected>[]
						: ApplySelection<UnArray<NonNullable<QueryResponse>>, Selected>
				> | null
			: Subscribeable<
					QueryResponse extends Array<any>
						? ApplySelection<UnArray<QueryResponse>, Selected>[]
						: ApplySelection<UnArray<QueryResponse>, Selected>
				>
	: Subscribeable<T>;

type Selection<O> = RequireAtLeastOneFieldSet<{
	[Key in keyof O]: NonNullable<UnArray<O[Key]>> extends (p: infer P) => infer A
		? P extends Record<string, any>
			? Selection<UnArray<NonNullable<A>>> & { [argsKey]: P }
			: Selection<UnArray<NonNullable<A>>>
		: boolean;
}>;

type ApplySelection<Object, Selection> = {
	[Key in keyof Selection & keyof Object]: Object[Key] extends (
		p: infer P,
	) => infer A
		? ReturnType<Object[Key]> extends Array<any>
			? Array<ApplySelection<UnArray<ReturnType<Object[Key]>>, Selection[Key]>>
			: ApplySelection<UnArray<Object[Key]>, Selection[Key]>
		: Object[Key];
};

type Subscribeable<Data> = {
	subscribe: (subscription: (value: Data) => void) => () => void;
};
