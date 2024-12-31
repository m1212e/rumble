import { db } from "../main";
import * as schema from "./schema";

async function seed() {
	// users
	await db.insert(schema.users).values({
		name: "John Doe",
		id: 1,
	});
	await db.insert(schema.users).values({
		name: "Jane Doe",
		id: 2,
	});

	// posts
	await db.insert(schema.posts).values({
		content: "Hello world",
		authorId: 1,
	});
	await db.insert(schema.posts).values({
		content: "Hello world 2",
		authorId: 2,
	});
}

seed();
