import * as t from "drizzle-orm/sqlite-core";
import { sqliteTable as table } from "drizzle-orm/sqlite-core";

export const users = table("users_table", {
  id: t.text().primaryKey(),
  firstName: t.text(),
  lastName: t.text(),
  email: t.text().notNull(),
});

export const posts = table("posts_table", {
  id: t.text().primaryKey(),
  title: t.text(),
  text: t.text(),
  ownerId: t.text().references(() => users.id, {
    onDelete: "cascade",
  }),
});

export const comments = table("comments_table", {
  id: t.text().primaryKey(),
  text: t.text(),
  published: t.integer({ mode: "boolean" }),
  someNumber: t.numeric({ mode: "number" }).default(0),
  postId: t
    .text()
    .notNull()
    .references(() => posts.id, {
      onDelete: "cascade",
    }),
  ownerId: t
    .text()
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
    }),
});
