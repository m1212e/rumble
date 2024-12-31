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

const { abilityBuilder, schemaBuilder, yoga } = await rumble({
	db,
	context(request) {
		return {
			userId: 1,
		};
	},
});

//
//   DEFINING ABILITIES
//

// users can edit themselves
// abilityBuilder.users
//   .allow(["read", "update", "delete"])
//   .when(({ userId }) => ({ where: eq(schema.users.id, userId) }));

// everyone can read posts
// abilityBuilder.posts.allow("read");
// only the author can update posts
// abilityBuilder.posts
//   .allow(["update", "delete"])
//   .when(({ userId }) => ({ where: eq(schema.posts.authorId, userId) }));

//
//   DEFINE OBJECTS WITH THEIR FIELDS
//

const UserRef = schemaBuilder.drizzleObject("users", {
	name: "User",
	fields: (t) => ({
		id: t.exposeInt("id"),
		name: t.exposeString("name"),
		// posts: t.relation("posts", {
		//   query: (_args, ctx) => ctx.abilities.posts.filter("read"),
		// }),
	}),
});

// const PostRef = schemaBuilder.drizzleObject("posts", {
//   name: "Post",
//   fields: (t) => ({
//     id: t.exposeInt("id"),
//     content: t.exposeString("content"),
//     author: t.relation("author", {
//       query: (_args, ctx) => ctx.abilities.users.filter("read"),
//     }),
//   }),
// });

//
//   DEFINE ROOT QUERIES AND MUTAITONS
//

// schemaBuilder.queryFields((t) => {
//   return {
//     findManyUsers: t.drizzleField({
//       type: [UserRef],
//       resolve: (query, root, args, ctx, info) => {
//         return db.query.users.findMany({
//           ...query,
//           ...ctx.abilities.users.filter("read"),
//         });
//       },
//     }),
//   };
// });

// schemaBuilder.queryFields((t) => {
//   return {
//     findFirstUser: t.drizzleField({
//       type: UserRef,
//       resolve: (query, root, args, ctx, info) => {
//         return (
//           db.query.users
//             .findFirst({
//               ...query,
//               where: ctx.abilities.users.filter("read").where,
//             })
//             // note that we need to manually raise an error if the value is not found
//             .then(assertFindFirstExists)
//         );
//       },
//     }),
//   };
// });

// // mutation to update the username
// schemaBuilder.mutationFields((t) => {
//   return {
//     updateUsername: t.drizzleField({
//       type: UserRef,
//       args: {
//         userId: t.arg.int({ required: true }),
//         newName: t.arg.string({ required: true }),
//       },
//       resolve: (query, root, args, ctx, info) => {
//         return (
//           db
//             .update(schema.users)
//             .set({
//               name: args.newName,
//             })
//             .where(
//               and(
//                 eq(schema.users.id, args.userId),
//                 ctx.abilities.users.filter("update").where
//               )
//             )
//             .returning({ id: schema.users.id, name: schema.users.name })
//             // note the different error mapper
//             .then(assertFirstEntryExists)
//         );
//       },
//     }),
//   };
// });

//
//   START THE SERVER
//

const server = createServer(yoga);
server.listen(3000, () => {
	console.log("Visit http://localhost:3000/graphql");
});
