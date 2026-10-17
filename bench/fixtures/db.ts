import { join } from "node:path";
import { getTableName, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { relations } from "../../test/src/db/relations";
import * as schema from "../../test/src/db/schema";

export { schema };

export type BenchDB = Awaited<ReturnType<typeof makeBenchDB>>["db"];

const sizes = {
  users: 500,
  postsPerUser: 4,
  commentsPerPost: 3,
};

const pad = (n: number) => n.toString().padStart(5, "0");

async function insertChunked<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
) {
  for (let i = 0; i < rows.length; i += 500) {
    await insert(rows.slice(i, i + 500));
  }
}

/**
 * An in memory SQLite database with the test schema and deterministic data,
 * so every run measures the same rows. Random seeding would let the result
 * sizes (and with them the timings) drift between runs.
 */
export async function makeBenchDB() {
  const db = drizzle(":memory:", { relations });
  await migrate(db, {
    migrationsFolder: join(import.meta.dir, "..", "..", "test", "drizzle"),
  });
  // the test schema has no foreign key indexes, without them every nested
  // relation is a full table scan and SQLite dominates the nested benches
  for (const [table, column] of [
    [schema.posts, schema.posts.ownerId],
    [schema.comments, schema.comments.postId],
    [schema.comments, schema.comments.ownerId],
  ] as const) {
    const index = sql.identifier(`${getTableName(table)}_${column.name}`);
    await db.run(
      sql`CREATE INDEX ${index} ON ${table} (${sql.identifier(column.name)})`,
    );
  }

  const users = Array.from({ length: sizes.users }, (_, i) => ({
    id: `user-${pad(i)}`,
    firstName: `First${i}`,
    // every tenth user without a last name, so isNull filters match something
    lastName: i % 10 === 0 ? null : `Last${i}`,
    email: `user${i}@example.com`,
  }));
  const posts = users.flatMap((u, i) =>
    Array.from({ length: sizes.postsPerUser }, (_, j) => ({
      id: `post-${pad(i * sizes.postsPerUser + j)}`,
      title: `Post ${j} of ${u.firstName}`,
      text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
      ownerId: u.id,
    })),
  );
  const comments = posts.flatMap((p, i) =>
    Array.from({ length: sizes.commentsPerPost }, (_, j) => ({
      id: `comment-${pad(i * sizes.commentsPerPost + j)}`,
      text: "Sed do eiusmod tempor incididunt ut labore.",
      published: j % 2 === 0,
      someNumber: (i * 7 + j) % 100,
      postId: p.id,
      ownerId: users[(i + j) % users.length].id,
    })),
  );

  await insertChunked(users, (c) => db.insert(schema.users).values(c));
  await insertChunked(posts, (c) => db.insert(schema.posts).values(c));
  await insertChunked(comments, (c) => db.insert(schema.comments).values(c));

  return { db, data: { users, posts, comments } };
}
