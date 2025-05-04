import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	posts: {
		author: r.one.usersdwaawd({
			from: r.posts.authorId,
			to: r.usersdwaawd.id,
		}),
	},
	users: {
		posts: r.many.posts({
			from: r.usersdwaawd.id,
			to: r.posts.authorId,
		}),
	},
}));
