import {
	createYoga as nativeCreateYoga,
	type YogaServerOptions,
} from "graphql-yoga";
import { useSofa } from "sofa-api";
import { createAbilityBuilder } from "./abilityBuilder";
import { createContextFunction } from "./context";
import { createEnumImplementer } from "./enum";
import { lazy } from "./helpers/lazy";
import { sofaOpenAPIWebhookDocs } from "./helpers/sofaOpenAPIWebhookDocs";
import { createObjectImplementer } from "./object";
import { createOrderArgImplementer } from "./orderArg";
import { createPubSubInstance } from "./pubsub";
import { createQueryImplementer } from "./query";
import { createSchemaBuilder } from "./schemaBuilder";
import { initSearchIfApplicable } from "./search";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";
import { createWhereArgImplementer } from "./whereArg";

export const rumble = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	PothosConfig extends CustomRumblePothosConfig,
	Action extends string = "read" | "update" | "delete",
>(
	rumbleInput: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>,
) => {
	// to be able to iterate over the actions, we populate the actions array in case the user does not
	if (!rumbleInput.actions) {
		rumbleInput.actions = ["read", "update", "delete"] as Action[];
	}

	if (rumbleInput.defaultLimit === undefined) {
		rumbleInput.defaultLimit = 100;
	}

	if (rumbleInput.search?.enabled) {
		initSearchIfApplicable(rumbleInput.db);
	}

	const abilityBuilder = createAbilityBuilder<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>(rumbleInput);

	const context = createContextFunction<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		typeof abilityBuilder
	>({
		...rumbleInput,
		abilityBuilder,
	});

	const { makePubSubInstance, pubsub } = createPubSubInstance<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>({
		...rumbleInput,
	});

	const { schemaBuilder } = createSchemaBuilder<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>({ ...rumbleInput, pubsub });
	const enum_ = createEnumImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		typeof schemaBuilder
	>({
		...rumbleInput,
		schemaBuilder,
	});
	const whereArg = createWhereArgImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		typeof schemaBuilder,
		typeof enum_
	>({
		...rumbleInput,
		schemaBuilder,
		enumImplementer: enum_,
	});
	const orderArg = createOrderArgImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		typeof schemaBuilder
	>({
		...rumbleInput,
		schemaBuilder,
	});
	const object = createObjectImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		typeof schemaBuilder,
		typeof whereArg,
		typeof orderArg,
		typeof enum_,
		typeof makePubSubInstance,
		typeof abilityBuilder
	>({
		...rumbleInput,
		schemaBuilder,
		makePubSubInstance,
		whereArgImplementer: whereArg,
		orderArgImplementer: orderArg,
		enumImplementer: enum_,
		abilityBuilder,
	});
	const query = createQueryImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		typeof schemaBuilder,
		typeof whereArg,
		typeof orderArg,
		typeof makePubSubInstance
	>({
		...rumbleInput,
		schemaBuilder,
		whereArgImplementer: whereArg,
		orderArgImplementer: orderArg,
		makePubSubInstance,
	});

	const builtSchema = lazy(() => schemaBuilder.toSchema());

	const createYoga = (
		args?:
			| Omit<YogaServerOptions<RequestEvent, any>, "schema" | "context">
			| undefined,
	) =>
		nativeCreateYoga<RequestEvent>({
			...args,
			schema: builtSchema(),
			context,
		});

	const createSofa = (
		args: Omit<Parameters<typeof useSofa>[0], "schema" | "context">,
	) => {
		if (args.openAPI) {
			args.openAPI = {
				...sofaOpenAPIWebhookDocs,
				...args.openAPI,
			};
		}
		return useSofa({
			...args,
			schema: builtSchema(),
			context,
		});
	};

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
       * Creates the native yoga instance. Can be used to run an actual HTTP server.
       * 
       * @example
       * 
       * ```ts
	   * 
        import { createServer } from "node:http";
		* const server = createServer(createYoga());
		server.listen(3000, () => {
            console.info("Visit http://localhost:3000/graphql");
			});
			* ```
	   * https://the-guild.dev/graphql/yoga-server/docs#server
       */
		createYoga,
		/**
		 * Creates a sofa instance to offer a REST API.
		```ts
		import express from 'express';
		
		const app = express();
		const sofa = createSofa(...);
		
		app.use('/api', useSofa({ schema }));
		```
		* https://the-guild.dev/graphql/sofa-api/docs#usage
		 */
		createSofa,
		/**
		 * A function for creating default objects for your schema
		 */
		object,
		/**
		 * A function for creating where args to filter entities
		 */
		whereArg,
		/**
		 * A function for creating order args to sort entities
		 */
		orderArg,
		/**
		 * A function for creating default READ queries.
		 * Make sure the objects for the table you are creating the queries for are implemented
		 */
		query,
		/**
		 * A function for creating a pubsub instance for a table. Use this to publish or subscribe events
		 */
		pubsub: makePubSubInstance,
		/**
		 * A function to implement enums for graphql usage.
		 * The other helpers use this helper internally so in most cases you do not have to
		 * call this helper directly, unless you need the reference to an enum type
		 */
		enum_,
	};
};
