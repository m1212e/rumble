import type {
	Maybe,
	Post,
	User,
} from "../../example/src/generated-client/graphql";
import { makeSelector } from "./selections";

type awawd = {
	__typename?: "Query";
	posts?: Maybe<Array<Post>>;
	postsFiltered?: Maybe<Array<Post>>;
	status: string;
	/** Get a single user by ID */
	user: User;
	/** List all users */
	users: Array<User>;
};

type StripGraphqlStuffFromObject<T> = Required<{
	[K in keyof Omit<T, "__typename">]: NonNullable<Omit<T, "__typename">[K]>;
}>;

export function makeQuery<Query extends Record<string, any>>(query: Query) {
	type NonNullableFields = StripGraphqlStuffFromObject<Query>;
	type NonArrayFields = {
		[K in keyof NonNullableFields]: NonNullableFields[K] extends Array<any>
			? NonNullableFields[K][number]
			: NonNullableFields[K];
	};

	function queryField<FieldReturnType>() {
		return "adawd";
	}

	const selectors = Object.fromEntries(
		Object.entries(query as NonArrayFields).map(([key, value]) => [
			key,
			queryField(),
		]),
	) as {
		[K in keyof NonArrayFields]: ReturnType<
			typeof queryField<NonArrayFields[K]>
		>;
	};
}

const p: awawd = {
	__typename: "Query",
	posts: null,
	postsFiltered: null,
	user: {} as any,
	users: [],
	status: "ok",
} as any;
const q = makeQuery(p);

q.posts.selectionProxy.content.author;

console.log(q.posts.selectedkeys);
