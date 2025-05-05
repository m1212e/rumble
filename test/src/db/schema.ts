import { sqliteTable as table } from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";

export const users = table("users", {
	id: t.text().primaryKey(),
	firstName: t.text("first_name"),
	lastName: t.text("last_name"),
	email: t.text().notNull(),
});

export const posts = table("posts", {
	id: t.text().primaryKey(),
	text: t.text(),
	title: t.text(),
	ownerId: t.text("owner_id").references(() => users.id, {
		onDelete: "cascade",
	}),
});

export const comments = table("comments", {
	id: t.text().primaryKey(),
	text: t.text({ length: 256 }),
	published: t.integer({ mode: "boolean" }),
	postId: t.text("post_id").references(() => posts.id, {
		onDelete: "cascade",
	}),
	ownerId: t
		.text("owner_id")
		.notNull()
		.references(() => users.id, {
			onDelete: "cascade",
		}),
});
