import {
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	text,
} from "drizzle-orm/pg-core";

export const moodEnum = pgEnum("mood", ["sad", "ok", "happy"] as const);

export const usersdwaawd = pgTable("users_table", {
	id: serial("id").primaryKey(),
	name: text("name").notNull(),
	mood: moodEnum("mood").default("ok"),
});

export const posts = pgTable("posts", {
	id: serial("id").primaryKey(),
	content: text("content").notNull(),
	authorId: integer("author_id").references(() => usersdwaawd.id, {
		onDelete: "cascade",
	}),
});

export const booksToAuthors = pgTable(
	"books_to_authors",
	{
		authorId: integer("author_id"),
		bookId: integer("book_id"),
	},
	(table) => [primaryKey({ columns: [table.bookId, table.authorId] })],
);
