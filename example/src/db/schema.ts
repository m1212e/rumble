import { integer, pgEnum, pgTable, serial, text } from "drizzle-orm/pg-core";

export const moodEnum = pgEnum("mood_native", ["sad", "ok", "happy"] as const);

export const users = pgTable("users_table", {
  id: serial().primaryKey(),
  name: text().notNull(),
  moodcol: moodEnum().default("ok"),
});

export const posts = pgTable("posts_table", {
  id: serial().primaryKey(),
  content: text().notNull(),
  authorId: integer().references(() => users.id, {
    onDelete: "cascade",
  }),
});

export const comments = pgTable("comments_table", {
  id: serial().primaryKey(),
  text: text().notNull(),
  postId: integer().references(() => posts.id, {
    onDelete: "cascade",
  }),
  ownerId: integer().references(() => users.id, {
    onDelete: "cascade",
  }),
});
