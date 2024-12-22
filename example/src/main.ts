import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createAbilityBuilder } from "../../lib/abilities/builder";
import * as schema from "./db/schema";
import { createGQLServer } from "../../lib/gql/builder";

// biome-ignore lint/style/noNonNullAssertion: only an example
const db = drizzle(process.env.DATABASE_URL!, { schema });

type Context = {
  userId: number;
};
const abilityBuilder = createAbilityBuilder<Context, typeof db>({
  db,
});

abilityBuilder.posts.allow("read");

abilityBuilder.posts.allow("update").when((user) => ({
  where: eq(schema.users.id, user.userId),
}));

const { schemaBuilder, server } = await createGQLServer({
  abilityBuilder,
  db,
});

schemaBuilder.drizzleObject('awdad', {
	name: 'User',
	fields: (t) => ({
	  firstName: t.exposeString('first_name'),
	  lastName: t.exposeString('last_name'),
	}),
  });