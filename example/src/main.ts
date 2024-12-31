import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createAbilityBuilder } from "../../lib/abilities/builder";
import { rumble } from "../../lib/gql/builder";
import * as schema from "./db/schema";

// biome-ignore lint/style/noNonNullAssertion: only an example
const db = drizzle(process.env.DATABASE_URL!, { schema });

// type Context = {
//   userId: number;
// };
// const abilityBuilder = createAbilityBuilder<Context, typeof db>({
//   db,
// });

// abilityBuilder.posts.allow("read");

// abilityBuilder.posts.allow("update").when((user) => ({
//   where: eq(schema.users.id, user.userId),

// }));

// const { schemaBuilder, server } = await rumble({
//   db,
// });

// schemaBuilder.drizzleObject("awdad", {
//   name: "User",
//   fields: (t) => ({
//     firstName: t.exposeString("first_name"),
//     lastName: t.exposeString("last_name"),
//   }),
// });

const { abilityBuilder, schemaBuilder, server } = await rumble({
	db,
	context({ userId }: { userId: number }) {
		return {
			userId,
		};
	},
});

abilityBuilder.posts.allow("read").when({ where: eq(schema.users.id, 1) });
abilityBuilder.posts
	.allow("read")
	.when(({ userId }) => ({ where: eq(schema.users.id, userId) }));
abilityBuilder.posts
	.allow("read")
	.when(async ({ userId }) => ({ where: eq(schema.users.id, userId) }));

const UserRef = schemaBuilder.drizzleObject("users", {
	name: "User",
	fields: (t) => ({
		firstName: t.exposeString("first_name"),
		lastName: t.exposeString("last_name"),
	}),
});
