import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createAbilityBuilder } from "../../lib/abilities/builder";
import * as schema from "./db/schema";

// biome-ignore lint/style/noNonNullAssertion: only an example
const db = drizzle(process.env.DATABASE_URL!, { schema });

// const users = await db.query.users.findMany({
//   // where: {
//   // }
// });

// const user = await db.query.users.findFirst({
//   // where: {
//   // }
// });

// const db = {
//   query: {
//     users: {
//       findMany() {},
//     },
//     posts: {
//       findMany() {},
//     },
//   },
// };

type User = {
	id: number;
};
const abilityBuilder = createAbilityBuilder<User, typeof db>({
	db,
	//   actions: ["create", "update"],
});

abilityBuilder.posts.allow("create").when({
	where: eq(schema.users.id, 1),
});

abilityBuilder.posts.allow("update").when({
	where: eq(schema.users.id, 1),
});

abilityBuilder.posts.allow("read").when({
	where: eq(schema.users.id, 1),
});

abilityBuilder.posts.allow("read").when(async (user) => ({
	where: eq(schema.users.id, user.id),
}));

abilityBuilder.posts.allow("read").when((user) => ({
	where: eq(schema.users.id, user.id),
}));

console.log(abilityBuilder);

// db.query.posts.findMany({
//   where,
// });
