import { drizzle } from "drizzle-orm/node-postgres";
import { reset } from "drizzle-seed";
import * as schema from "./schema";

console.info("Seeding...");

const db = drizzle("postgres://postgres:postgres@localhost:5432/postgres", {
  schema,
});

console.info("Resetting database...");
await reset(db, schema);

console.info("Seeding users...");
// users
await db.insert(schema.users).values({
  name: "John Doe",
  id: 1,
});
await db.insert(schema.users).values({
  name: "Jane Doe",
  id: 2,
});

console.info("Seeding posts...");
// posts
await db.insert(schema.posts).values({
  content: "Hello world",
  authorId: 1,
});
await db.insert(schema.posts).values({
  content: "Hello world 2",
  authorId: 2,
});
await db.insert(schema.posts).values({
  content: "Hello world",
  authorId: 1,
});
await db.insert(schema.posts).values({
  content: "Hello world 2",
  authorId: 2,
});
await db.insert(schema.posts).values({
  content: "Hello world",
  authorId: 1,
});
await db.insert(schema.posts).values({
  content: "Hello world 2",
  authorId: 2,
});
await db.insert(schema.posts).values({
  content: "Hello world",
  authorId: 1,
});
await db.insert(schema.posts).values({
  content: "Hello world 2",
  authorId: 2,
});
await db.insert(schema.posts).values({
  content: "Hello world",
  authorId: 1,
});
await db.insert(schema.posts).values({
  content: "Hello world 2",
  authorId: 2,
});
await db.insert(schema.posts).values({
  content: "Hello world",
  authorId: 1,
});
await db.insert(schema.posts).values({
  content: "Hello world 2",
  authorId: 2,
});

console.info("Done seeding!");
process.exit(0);
