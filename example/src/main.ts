import { createServer } from "node:http";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { rumble } from "../../lib";
import { assertFirstEntryExists } from "../../lib/helpers/helper";
import * as schema from "./db/schema";

export const db = drizzle(
	"postgres://postgres:postgres@localhost:5432/postgres",
	{ schema },
);

const { abilityBuilder, schemaBuilder, arg, object, query, yoga, pubsub } =
	rumble({
		db,
		context(request) {
			return {
				userId: 2,
			};
		},
	});

//
//   DEFINING ABILITIES
//

// users can edit themselves
abilityBuilder.users
	.allow(["read", "update", "delete"])
	.when(({ userId }) => ({ where: eq(schema.users.id, userId) }));

// everyone can read posts
abilityBuilder.posts.allow("read");
// only the author can update posts
abilityBuilder.posts
	.allow(["update", "delete"])
	.when(({ userId }) => ({ where: eq(schema.posts.authorId, userId) }));

//
//   DEFINE OBJECTS WITH THEIR FIELDS
//

// you can define an object using pothos and its drizzle plugin like this
const PostRef = schemaBuilder.drizzleObject("posts", {
	name: "Post",
	fields: (t) => ({
		id: t.exposeInt("id"),
		content: t.exposeString("content"),
		author: t.relation("author", {
			query: (_args, ctx) => ctx.abilities.users.filter("read"),
		}),
	}),
});

// or you can use the helper to implement a default version of your object based on the db schema.
// It exposes all fields and restricts the query based on the abilities
const UserRef = object({
	name: "User",
	tableName: "users",
});

//
//   DEFINE ROOT QUERIES AND MUTATOINS
//

const {
	inputType: PostWhere,
	transformArgumentToQueryCondition: transformPostWhere,
} = arg({
	tableName: "posts",
});

// same for queries, use pothos to define them
schemaBuilder.queryFields((t) => {
	return {
		findManyPosts: t.drizzleField({
			type: [PostRef],
			args: {
				where: t.arg({ type: PostWhere, required: false }),
			},
			resolve: (query, root, args, ctx, info) => {
				return db.query.posts.findMany(
					// here you can apply the ability filter defined above
					query(ctx.abilities.posts.filter("read")),
				);
			},
		}),
	};
});

// or alternatively use the helper to define a findFirst and findMany query based on the db schema automatically
query({
	tableName: "users",
});

const { updated: updatedUser } = pubsub({
	tableName: "users",
});

// mutation to update the username
schemaBuilder.mutationFields((t) => {
	return {
		updateUsername: t.drizzleField({
			type: UserRef,
			args: {
				userId: t.arg.int({ required: true }),
				newName: t.arg.string({ required: true }),
			},
			resolve: (query, root, args, ctx, info) => {
				updatedUser(args.userId);
				return (
					db
						.update(schema.users)
						.set({
							name: args.newName,
						})
						.where(
							and(
								eq(schema.users.id, args.userId),
								ctx.abilities.users.filter("update").where,
							),
						)
						.returning({ id: schema.users.id, name: schema.users.name })
						// note the different error mapper
						.then(assertFirstEntryExists)
				);
			},
		}),
	};
});

//
//   START THE SERVER
//

// when we are done defining the objects, queries and mutations,
// we can start the server
const server = createServer(yoga());
server.listen(3000, () => {
	console.log("Visit http://localhost:3000/graphql");
});
