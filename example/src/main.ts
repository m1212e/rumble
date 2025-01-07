import { createServer } from "node:http";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { rumble } from "../../lib/gql/builder";
import {
	assertFindFirstExists,
	assertFirstEntryExists,
} from "../../lib/helpers/helper";
import * as schema from "./db/schema";

export const db = drizzle(
	"postgres://postgres:postgres@localhost:5432/postgres",
	{ schema },
);

const {
	abilityBuilder,
	schemaBuilder,
	yoga,
	implementDefaultObject,
	implementWhereArg,
} = rumble({
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

// you can use the helper to implement a default version of your object based on the db schema.
// It exposes all fields and restricts the query based on the abilities
const UserRef = implementDefaultObject({
	name: "User",
	tableName: "users",
});

// alternatively you can define the object manually
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

//
//   DEFINE ROOT QUERIES AND MUTATOINS
//

const {
	inputType: UserWhere,
	transformArgumentToQueryCondition: transformUserWhere,
} = implementWhereArg({
	tableName: "users",
});

schemaBuilder.queryFields((t) => {
	return {
		findManyUsers: t.drizzleField({
			type: [UserRef],
			args: {
				where: t.arg({ type: UserWhere }),
			},
			resolve: (query, root, args, ctx, info) => {
				return db.query.users.findMany(
					query(
						ctx.abilities.users.filter("read", {
							inject: { where: transformUserWhere(args.where) },
						}),
					),
				);
			},
		}),
	};
});

schemaBuilder.queryFields((t) => {
	return {
		findManyPosts: t.drizzleField({
			type: [PostRef],
			resolve: (query, root, args, ctx, info) => {
				return db.query.posts.findMany(
					query(ctx.abilities.posts.filter("read")),
				);
			},
		}),
	};
});

schemaBuilder.queryFields((t) => {
	return {
		findFirstUser: t.drizzleField({
			type: UserRef,
			resolve: (query, root, args, ctx, info) => {
				return (
					db.query.users
						.findFirst(
							query({
								where: ctx.abilities.users.filter("read").where,
							}),
						)
						// note that we need to manually raise an error if the value is not found
						.then(assertFindFirstExists)
				);
			},
		}),
	};
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
