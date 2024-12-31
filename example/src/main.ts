import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { rumble } from "../../lib/gql/builder";
import * as schema from "./db/schema";

// biome-ignore lint/style/noNonNullAssertion: only an example
const db = drizzle(process.env.DATABASE_URL!, { schema });

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

const UserRef = schemaBuilder.drizzleObject("users", {
	name: "User",
	fields: (t) => ({
		name: t.exposeString("name"),
		posts: t.relation("posts", {
			query: (_args, ctx) => ctx.abilities.posts.filter("read"),
		}),
		invitee: t.relation("invitee", {
			query: (_args, ctx) => ({
				where: ctx.abilities.users.filter("read").where,
				limit: 1,
			}),
		}),
	}),
});
