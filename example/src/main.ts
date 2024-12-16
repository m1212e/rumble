import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createBuilder } from "../../lib/abilities/builder";
import * as schema from "./db/schema";

// biome-ignore lint/style/noNonNullAssertion: only an example
// const db = drizzle(process.env.DATABASE_URL!, { schema });

// const users = await db.query.users.findMany({
//   // where: {
//   // }
// });

// const user = await db.query.users.findFirst({
//   // where: {
//   // }
// });

const db = {
	query: {
		users: {
			findMany() {},
		},
		posts: {
			findMany() {},
		},
	},
} as any;
const abilityBuilder = createBuilder({
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

console.log(abilityBuilder);

// db.query.posts.findMany({
//   where,
// });
