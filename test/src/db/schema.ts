import { faker } from "@faker-js/faker";
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
		ownerId: t.text("owner_id").references(() => users.id),
	},
	(table) => [
		t.uniqueIndex("slug_idx").on(table.slug),
		t.index("title_idx").on(table.title),
	],
);

export const comments = table("comments", {
	id: t.text().primaryKey(),
	text: t.text({ length: 256 }),
	postId: t.text("post_id").references(() => posts.id),
	ownerId: t.text("owner_id").references(() => users.id),
});
