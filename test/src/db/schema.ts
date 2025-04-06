import { faker } from "@faker-js/faker";
import { relations } from "drizzle-orm";
import { sqliteTable as table } from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";

export const users = table(
	"users",
	{
		id: t.text().primaryKey(),
		firstName: t.text("first_name"),
		lastName: t.text("last_name"),
		email: t.text().notNull(),
	},
	(table) => [t.uniqueIndex("email_idx").on(table.email)],
);

export const posts = table(
	"posts",
	{
		id: t.text().primaryKey(),
		slug: t.text().$default(() => faker.lorem.slug()),
		title: t.text(),
		ownerId: t.text("owner_id").references(() => users.id, {
			onDelete: "cascade",
		}),
	},
	(table) => [
		t.uniqueIndex("slug_idx").on(table.slug),
		t.index("title_idx").on(table.title),
	],
);

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

export const usersRelations = relations(users, ({ one, many }) => ({
	posts: many(posts),
	comments: many(comments),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
	author: one(users, { fields: [posts.ownerId], references: [users.id] }),
	comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
	author: one(users, { fields: [comments.ownerId], references: [users.id] }),
	post: one(posts, { fields: [comments.postId], references: [posts.id] }),
}));
