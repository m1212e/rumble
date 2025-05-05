import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	users: {
		posts: r.many.posts({
			from: r.users.id,
			to: r.posts.ownerId,
		}),
		comments: r.many.comments({
			from: r.users.id,
			to: r.comments.ownerId,
		}),
	},
	posts: {
		comments: r.many.comments({
			from: r.posts.id,
			to: r.comments.postId,
		}),
		author: r.one.users({
			from: r.posts.ownerId,
			to: r.users.id,
		}),
	},
	comments: {
		author: r.one.users({
			from: r.comments.ownerId,
			to: r.users.id,
		}),
		post: r.one.posts({
			from: r.comments.postId,
			to: r.posts.id,
		}),
	},
}));
