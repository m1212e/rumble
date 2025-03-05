import { join } from "node:path";
import { faker } from "@faker-js/faker";
import type { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export async function seedTestDbInstance(
	db: ReturnType<typeof drizzle<typeof schema>>,
) {
	console.info("Seeding...");
	console.info("Migrating database...");
	await migrate(db, {
		migrationsFolder: join(import.meta.dir, "..", "..", "drizzle"),
	});

	console.info("Seeding users...");
	for (let count = 0; count < 10; count++) {
		await db.insert(schema.users).values({
			id: faker.database.mongodbObjectId(),
			email: faker.internet.email(),
			firstName: faker.person.firstName(),
			lastName: faker.person.lastName(),
		});
	}
	const users = await db.select().from(schema.users);

	console.info("Seeding posts...");
	for (let count = 0; count < 10; count++) {
		await db.insert(schema.posts).values({
			id: faker.database.mongodbObjectId(),
			ownerId: users[count].id,
			slug: faker.lorem.slug(),
			title: faker.lorem.sentence(),
		});
	}

	const posts = await db.select().from(schema.posts);

	console.info("Seeding comments...");
	for (let count = 0; count < 10; count++) {
		await db.insert(schema.comments).values({
			id: faker.database.mongodbObjectId(),
			ownerId: users[count].id,
			postId: posts[count].id,
			text: faker.lorem.sentence(),
		});
	}

	const comments = await db.select().from(schema.comments);

	console.info("Done seeding!");

	return {
		users,
		posts,
		comments,
	};
}
