import { EnvelopArmorPlugin } from "@escape.tech/graphql-armor";
import { useDisableIntrospection } from "@graphql-yoga/plugin-disable-introspection";
import { merge } from "es-toolkit";
import {
  createYoga as nativeCreateYoga,
  type YogaServerOptions,
} from "graphql-yoga";
import { useSofa } from "sofa-api";
import { createAbilityBuilder } from "./abilityBuilder";
import { createOrderArgImplementer } from "./args/orderArg";
import { createWhereArgImplementer } from "./args/whereArg";
import { clientCreatorImplementer } from "./client/client";
import { createContextFunction } from "./context";
import { createCountQueryImplementer } from "./countQuery";
import { createEnumImplementer } from "./enum";
import { lazy } from "./helpers/lazy";
import { sofaOpenAPIWebhookDocs } from "./helpers/sofaOpenAPIWebhookDocs";
import { createObjectImplementer } from "./object";
import { createPubSubInstance } from "./pubsub";
import { createQueryImplementer } from "./query";
import { createSchemaBuilder } from "./schemaBuilder";
import { initSearchIfApplicable } from "./search";
import type { DrizzleInstance } from "./types/drizzleInstanceType";
import { RumbleError } from "./types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";

export const rumble = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  PothosConfig extends CustomRumblePothosConfig,
  Action extends string = "read" | "update" | "delete",
>(
  rumbleInput: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>,
) => {
  if (!rumbleInput.db._.schema) {
    throw new RumbleError(`
rumble could not find any schema in the provided drizzle instance.
Make sure you import the schema and pass it to the drizzle instance:

export const db = drizzle(
  "postgres://postgres:postgres@localhost:5432/postgres",
  {
    relations,
    schema,    // <--- add this line
  },
);

`);
  }

  if (!rumbleInput.db._.relations) {
    throw new RumbleError(`
rumble could not find any relations in the provided drizzle instance.
Make sure you import the relations and pass them to the drizzle instance:

export const db = drizzle(
  "postgres://postgres:postgres@localhost:5432/postgres",
  {
    relations, // <--- add this line
    schema,   
  },
);

`);
  }

  // to be able to iterate over the actions, we populate the actions array in case the user does not
  if (!rumbleInput.actions) {
    rumbleInput.actions = ["read", "update", "delete"] as Action[];
  }

  if (rumbleInput.defaultLimit === undefined) {
    rumbleInput.defaultLimit = 100;
  }

  if (rumbleInput.search?.enabled) {
    initSearchIfApplicable(rumbleInput);
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

  const countQuery = createCountQueryImplementer({
    ...rumbleInput,
    schemaBuilder,
    whereArgImplementer: whereArg,
    makePubSubInstance,
  });

  const builtSchema = lazy(() => schemaBuilder.toSchema());

  const createYoga = (
    args?:
      | (Omit<YogaServerOptions<RequestEvent, any>, "schema" | "context"> & {
          /**
           * Determines if the API should disclose various things about its structure.
           * Defaults to `process.env.NODE_ENV === "development"`.
           * If enabled, the api will allow introspection requests, provide the graphiql
           * explorer and will not apply the additional envelop armor plugin.
           */
          enableApiDocs?: boolean;
        })
      | undefined,
  ) => {
    const enableApiDocs =
      args?.enableApiDocs ?? process?.env?.NODE_ENV === "development";

    return nativeCreateYoga<RequestEvent>({
      ...args,
      graphiql: enableApiDocs,
      plugins: [
        ...(args?.plugins ?? []),
        ...(enableApiDocs
          ? []
          : [useDisableIntrospection(), EnvelopArmorPlugin()]),
      ].filter(Boolean),
      schema: builtSchema(),
      context,
    });
  };

  const createSofa = (
    args: Omit<Parameters<typeof useSofa>[0], "schema" | "context">,
  ) => {
    if (args.openAPI) {
      merge(args.openAPI, sofaOpenAPIWebhookDocs);
    }
    return useSofa({
      ...args,
      schema: builtSchema(),
      context,
    });
  };

  const clientCreator = clientCreatorImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    typeof schemaBuilder
  >({
    ...rumbleInput,
    builtSchema,
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
    /**
     * Create a client to consume a rumble graphql api at the specified location.
     * Requires GraphQL, does not work with the SOFA REST API.
     */
    clientCreator,
    /**
     * A function for creating count queries for your tables
     */
    countQuery,
  };
};
