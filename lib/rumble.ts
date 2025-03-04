import { createYoga } from "graphql-yoga";
import { createAbilityBuilder } from "./abilityBuilder";
import { createContextFunction } from "./context";
import { createObjectImplementer } from "./object";
import { createSchemaBuilder } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";
import { createArgImplementer } from "./whereArg";

export const rumble = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string = "read" | "create" | "update" | "delete",
>(
	rumbleInput: RumbleInput<UserContext, DB, RequestEvent, Action>,
) => {
	const abilityBuilder = createAbilityBuilder<
		UserContext,
		DB,
		RequestEvent,
		Action
	>(rumbleInput);

	const context = createContextFunction<
		UserContext,
		DB,
		RequestEvent,
		Action,
		typeof abilityBuilder
	>({
		...rumbleInput,
		abilityBuilder,
	});

	const schemaBuilder = createSchemaBuilder<
		UserContext,
		DB,
		RequestEvent,
		Action,
		typeof context
	>(rumbleInput);

	const object = createObjectImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		typeof schemaBuilder
	>({
		...rumbleInput,
		schemaBuilder,
	});
	const arg = createArgImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		typeof schemaBuilder
	>({
		...rumbleInput,
		schemaBuilder,
	});

	const yoga = () =>
		createYoga<RequestEvent>({
			...rumbleInput.nativeServerOptions,
			schema: schemaBuilder.toSchema(),
			context,
		});

	return {
		/**
       * The ability builder. Use it to declare whats allowed for each entity in your DB.
       * 
       * @example
       * 
       * ```ts
       * // users can edit themselves
       abilityBuilder.users
         .allow(["read", "update", "delete"])
         .when(({ userId }) => ({ where: eq(schema.users.id, userId) }));
       
       // everyone can read posts
       abilityBuilder.posts.allow("read");
       * 
       * ```
       */
		abilityBuilder,
		/**
		 * The pothos schema builder. See https://pothos-graphql.dev/docs/plugins/drizzle
		 */
		schemaBuilder,
		/**
       * The native yoga instance. Can be used to run an actual HTTP server.
       * 
       * @example
       * 
       * ```ts
        import { createServer } from "node:http";
       * const server = createServer(yoga());
       server.listen(3000, () => {
            console.log("Visit http://localhost:3000/graphql");
       });
       * ```
       */
		yoga,
		/**
		 * A function for creating default objects for your schema
		 */
		object,
		/**
		 * A function for creating where args to filter entities
		 */
		arg,
	};
};
