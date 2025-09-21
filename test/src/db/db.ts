import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { reset, seed } from "drizzle-seed";
import { relations } from "./relations";
import * as schema from "./schema";

const dummy = drizzle(":memory:", { relations });
export type DB = typeof dummy;

export async function makeSeededDBInstanceForTest() {
	const db = drizzle(":memory:", { relations });
	await migrate(db, {
		migrationsFolder: join(import.meta.dir, "..", "..", "drizzle"),
	});
	await reset(db, schema);

	await seed(db, { users: schema.users }, { count: 200 }).refine((r) => ({
		users: {
			columns: {
				id: r.uuid(),
				email: r.email(),
				firstName: r.firstName(),
				lastName: r.lastName(),
			},
		},
	}));
	const users = await db.query.users.findMany();

	await seed(db, { posts: schema.posts }, { count: 200 }).refine((r) => ({
		posts: {
			columns: {
				id: r.uuid(),
				title: r.jobTitle(),
				text: r.loremIpsum(),
				ownerId: r.valuesFromArray({
					values: users.map((u) => u.id),
				}),
			},
		},
	}));
	const posts = await db.query.posts.findMany();

	await seed(db, { comments: schema.comments }, { count: 200 }).refine((r) => ({
		comments: {
			columns: {
				id: r.uuid(),
				text: r.loremIpsum(),
				someNumber: r.int(),
				ownerId: r.valuesFromArray({
					values: users.map((u) => u.id),
				}),
				postId: r.valuesFromArray({
					values: posts.map((u) => u.id),
				}),
				published: r.boolean(),
			},
		},
	}));

	const comments = await db.query.comments.findMany();

	return { db, data: { users, posts, comments }, schema };
}
