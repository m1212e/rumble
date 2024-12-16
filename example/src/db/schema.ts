import {
	type AnyPgColumn,
	boolean,
	integer,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { relations } from "drizzle-orm";

export const users = pgTable("users", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	invitedBy: integer("invited_by").references((): AnyPgColumn => users.id),
});

export const usersRelations = relations(users, ({ one, many }) => ({
	invitee: one(users, { fields: [users.invitedBy], references: [users.id] }),
	usersToGroups: many(usersToGroups),
	posts: many(posts),
}));

export const groups = pgTable("groups", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
});

export const groupsRelations = relations(groups, ({ many }) => ({
	usersToGroups: many(usersToGroups),
}));

export const usersToGroups = pgTable(
	"users_to_groups",
	{
		id: serial("id").primaryKey(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id),
		groupId: integer("group_id")
			.notNull()
			.references(() => groups.id),
	},
	(t) => ({
		pk: primaryKey(t.userId, t.groupId),
	}),
);

export const usersToGroupsRelations = relations(usersToGroups, ({ one }) => ({
	group: one(groups, {
		fields: [usersToGroups.groupId],
		references: [groups.id],
	}),
	user: one(users, { fields: [usersToGroups.userId], references: [users.id] }),
}));

export const posts = pgTable("posts", {
	id: serial("id").primaryKey(),
	content: text("content").notNull(),
	authorId: integer("author_id").references(() => users.id),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const postsRelations = relations(posts, ({ one, many }) => ({
	author: one(users, { fields: [posts.authorId], references: [users.id] }),
	comments: many(comments),
}));

export const comments = pgTable("comments", {
	id: serial("id").primaryKey(),
	content: text("content").notNull(),
	creator: integer("creator").references(() => users.id),
	postId: integer("post_id").references(() => posts.id),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const commentsRelations = relations(comments, ({ one, many }) => ({
	post: one(posts, { fields: [comments.postId], references: [posts.id] }),
	author: one(users, { fields: [comments.creator], references: [users.id] }),
	likes: many(commentLikes),
}));

export const commentLikes = pgTable("comment_likes", {
	id: serial("id").primaryKey(),
	creator: integer("creator").references(() => users.id),
	commentId: integer("comment_id").references(() => comments.id),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const commentLikesRelations = relations(commentLikes, ({ one }) => ({
	comment: one(comments, {
		fields: [commentLikes.commentId],
		references: [comments.id],
	}),
	author: one(users, {
		fields: [commentLikes.creator],
		references: [users.id],
	}),
}));
