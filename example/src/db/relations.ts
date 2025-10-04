import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  users: {
    posts: r.many.posts({
      from: r.users.id,
      to: r.posts.authorId,
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
      from: r.posts.authorId,
      to: r.users.id,
      optional: false,
    }),
  },
  comments: {
    author: r.one.users({
      from: r.comments.ownerId,
      to: r.users.id,
      optional: false,
    }),
    post: r.one.posts({
      from: r.comments.postId,
      to: r.posts.id,
      optional: false,
    }),
  },
}));
