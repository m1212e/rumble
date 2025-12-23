import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { assertFirstEntryExists, rumble } from "../../../lib";
import type { DB } from "../db/db";
import * as schema from "../db/schema";

export function makeRumbleSeedInstance(
  db: DB,
  userId?: string,
  defaultLimit: number | null = null,
) {
  const r = rumble({
    db,
    context(_request) {
      return {
        userId: userId ?? "123",
      };
    },
    defaultLimit,
  });

  const UserRef = r.object({
    refName: "User",
    table: "users",
    adjust(t) {
      return {
        fullName: t.field({
          type: "String",
          resolve: (parent, _args, _context, _info) =>
            `${parent.firstName} ${parent.lastName}`,
        }),
        firstName: t.field({
          type: "String",
          nullable: true,
          resolve: (parent, _args, _context, _info) => parent.firstName,
        }),
      };
    },
  });
  r.query({ table: "users" });
  const { updated: updatedUser } = r.pubsub({
    table: "users",
  });
  r.countQuery({ table: "users" });

  r.object({ refName: "Post", table: "posts" });
  r.query({ table: "posts" });

  r.object({ refName: "Comment", table: "comments" });
  r.query({ table: "comments" });

  r.schemaBuilder.mutationFields((t) => {
    return {
      updateUsername: t.drizzleField({
        type: UserRef,
        args: {
          userId: t.arg.string({ required: true }),
          firstName: t.arg.string({ required: true }),
        },
        resolve: async (_query, _root, args, ctx, _info) => {
          const r = await db
            .update(schema.users)
            .set({
              firstName: args.firstName,
            })
            .where(
              ctx.abilities.users.filter("update").merge({
                where: { id: args.userId },
              }).sql.where,
            )
            .returning({
              id: schema.users.id,
              firstName: schema.users.firstName,
              lastName: schema.users.lastName,
              email: schema.users.email,
            })
            .then(assertFirstEntryExists);

          updatedUser(args.userId);
          return r;
        },
      }),
    };
  });

  return {
    rumble: r,
    build: () => {
      const yogaInstance = r.createYoga();
      const executor = buildHTTPExecutor({
        fetch: yogaInstance.fetch,
        endpoint: "http://yoga/graphql",
      });
      return { executor, yogaInstance };
    },
  };
}
