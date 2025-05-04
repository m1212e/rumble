import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/bun-sqlite";
import { assertFirstEntryExists, rumble } from "../../../lib";
import * as schema from "../db/schema";

export function makeRumbleSeedInstance(
	db: ReturnType<typeof drizzle<typeof schema>>,
	userId?: string,
	defaultLimit: number | null = null,
) {
	const r = rumble({
		db,
		context(request) {
			return {
				userId: userId ?? "123",
			};
		},
		defaultLimit,
	});

	const UserRef = r.object({ refName: "User", table: "users" });
	r.query({ table: "users" });
	const { updated: updatedUser } = r.pubsub({
		table: "users",
	});

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
				resolve: (query, root, args, ctx, info) => {
					updatedUser(args.userId);
					return db
						.update(schema.users)
						.set({
							firstName: args.firstName,
						})
						.where(
							ctx.abilities.users.filter("update", {
								inject: {
									where: eq(schema.users.id, args.userId),
								},
							}).single.where,
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
			const yogaInstance = r.createYoga();
			const executor = buildHTTPExecutor({
				fetch: yogaInstance.fetch,
				endpoint: "http://yoga/graphql",
			});
			return { executor, yogaInstance };
		},
	};
}
