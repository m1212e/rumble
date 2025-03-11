import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/bun-sqlite";
import { assertFirstEntryExists, rumble } from "../../../lib";
import * as schema from "../db/schema";

export function makeRumbleSeedInstance(
	db: ReturnType<typeof drizzle<typeof schema>>,
	userId?: string,
) {
	const r = rumble({
		db,
		context(request) {
			return {
				userId: userId ?? "123",
			};
		},
	});

	const UserRef = r.object({ name: "User", tableName: "users" });
	r.query({ tableName: "users" });
	const { updated: updatedUser } = r.pubsub({
		tableName: "users",
	});

	r.object({ name: "Post", tableName: "posts" });
	r.query({ tableName: "posts" });

	r.object({ name: "Comment", tableName: "comments" });
	r.query({ tableName: "comments" });

	r.schemaBuilder.mutationFields((t) => {
		return {
			updateUsername: t.drizzleField({
				type: UserRef,
				args: {
					userId: t.arg.string({ required: true }),
					firstName: t.arg.string({ required: true }),
				},
				resolve: (query, root, args, ctx, info) => {
					updatedUser(args.userId);
					return db
						.update(schema.users)
						.set({
							firstName: args.firstName,
						})
						.where(
							and(
								eq(schema.users.id, args.userId),
								ctx.abilities.users.filter("update").where,
							),
						)
						.returning({
							id: schema.users.id,
							firstName: schema.users.firstName,
							lastName: schema.users.lastName,
							email: schema.users.email,
						})
						.then(assertFirstEntryExists);
				},
			}),
		};
	});

	return {
		rumble: r,
		build: () => {
			const yogaInstance = r.yoga();
			const executor = buildHTTPExecutor({
				fetch: yogaInstance.fetch,
				endpoint: "http://yoga/graphql",
			});
			return { executor, yogaInstance };
		},
	};
}
