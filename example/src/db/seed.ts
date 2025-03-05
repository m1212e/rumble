import { drizzle } from "drizzle-orm/node-postgres";
import { reset } from "drizzle-seed";
import * as schema from "./schema";

console.log("Seeding...");

const db = drizzle("postgres://postgres:postgres@localhost:5432/postgres", {
	schema,
});

console.log("Resetting database...");
await reset(db, schema);

console.log("Seeding users...");
// users
await db.insert(schema.users).values({
	name: "John Doe",
	id: 1,
});
await db.insert(schema.users).values({
	name: "Jane Doe",
	id: 2,
});

console.log("Seeding posts...");
// posts
await db.insert(schema.posts).values({
	content: "Hello world",
	authorId: 1,
});
await db.insert(schema.posts).values({
	content: "Hello world 2",
	authorId: 2,
});

console.log("Done seeding!");
process.exit(0);
