import type { Query } from "../../example/src/generated-client/graphql";
import type { UnArray } from "./utilTypes";

export function makeQuery<Query extends Record<string, any>>() {
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

				// return queryFunction;
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
	: <S extends SelectionObjectType<Partial<UnArray<T>>>>(
			selection: S,
		) => Promise<ApplySelection<UnArray<T>, S>>;

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
			: ApplySelection<UnArray<Object[Key]>, Selection[Key]>
		: never;
};

// TODO: array fixes needed

const q = makeQuery<Query>();
const users = await q.users({
	id: true,
	name: true,
	moodcol: true,
	somethingElse: true,
	posts: {
		id: true,
	},
});
users.posts;
