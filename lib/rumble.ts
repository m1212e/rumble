import { EnvelopArmorPlugin } from "@escape.tech/graphql-armor";
import { useDisableIntrospection } from "@graphql-yoga/plugin-disable-introspection";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { AttributeNames, SpanNames } from "@pothos/tracing-opentelemetry";
import { merge } from "es-toolkit";
import type { ServerOptions } from "graphql-ws";
import {
  createYoga as nativeCreateYoga,
  type Plugin,
  type YogaServerOptions,
} from "graphql-yoga";
import type { useSofa } from "sofa-api";
import packagejson from "../package.json";
import { createAbilityBuilder } from "./abilityBuilder";
import { createOrderArgImplementer } from "./args/orderArg";
import { createWhereArgImplementer } from "./args/whereArg";
import { clientCreatorImplementer } from "./client/client";
import { createContextFunction } from "./context";
import { createCountQueryImplementer } from "./countQuery";
import { createEnumImplementer, type EnumFieldKeys } from "./enum";
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
  Schema extends Record<string, any>,
  Action extends string = "read" | "update" | "delete",
>(
  rumbleInput: RumbleInput<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  > & {
    schema: Schema;
  },
) => {
  if (!rumbleInput.db._.relations) {
    throw new RumbleError(`
rumble could not find any relations in the provided drizzle instance.
Make sure you import the relations and pass them to the drizzle instance:

export const db = drizzle(
  "postgres://postgres:postgres@localhost:5432/postgres",
  {
    relations, // <--- add this line
  },
);

`);
  }

  if (
    !rumbleInput.schema ||
    typeof rumbleInput.schema !== "object" ||
    Object.keys(rumbleInput.schema).length === 0
  ) {
    throw new RumbleError(`
rumble requires the drizzle schema object to be passed when initializing.
Import your schema module and pass it alongside \`db\`:

import * as schema from "./db/schema";

export const r = rumble({
  db,
  schema, // <--- add this line
});

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

  if (rumbleInput.otel?.enabled && !rumbleInput.otel.tracer) {
    rumbleInput.otel.tracer = trace.getTracer(
      "@m1212e/rumble",
      packagejson.version,
    );
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
    PothosConfig
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
    EnumFieldKeys<Schema>,
    Schema
  >({
    ...rumbleInput,
    schemaBuilder,
  });

  const whereArg = createWhereArgImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
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
    PothosConfig
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
    Schema
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
    Schema
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
          /**
           * Optional configuration passed to the auto-installed graphql-armor
           * EnvelopArmorPlugin. Only applied when `enableApiDocs` is false
           * (i.e. in production). Useful for relaxing the default depth/alias/
           * directive/token limits when the generated schema legitimately exceeds
           * them. See https://github.com/Escape-Technologies/graphql-armor for available options.
           *
           * @example
           * createYoga({ armorConfig: { maxDepth: { n: 20 } } })
           */
          armorConfig?: Parameters<typeof EnvelopArmorPlugin>[0];
        })
      | undefined,
  ) => {
    const enableApiDocs =
      args?.enableApiDocs ?? process?.env?.NODE_ENV === "development";

    return nativeCreateYoga<RequestEvent>({
      ...args,
      graphiql: enableApiDocs,
      schema: builtSchema(),
      context,
      plugins: [
        ...(args?.plugins ?? []),
        ...(enableApiDocs
          ? []
          : [useDisableIntrospection(), EnvelopArmorPlugin(args?.armorConfig)]),
        rumbleInput.otel?.enabled
          ? ({
              // TODO: add trace header per default in http response
              // TODO: Automatic Persisted Queries
              onExecute: ({ setExecuteFn, executeFn }) => {
                setExecuteFn((options) =>
                  rumbleInput.otel!.tracer!.startActiveSpan(
                    SpanNames.EXECUTE,
                    {
                      attributes: {
                        [AttributeNames.OPERATION_NAME]:
                          options.operationName ?? "anonymous",
                        [AttributeNames.SOURCE]: options.document,
                      },
                    },
                    async (span) => {
                      try {
                        const result = await executeFn(options);

                        if (
                          result &&
                          "errors" in result &&
                          result.errors?.length
                        ) {
                          for (const error of result.errors) {
                            span.recordException(error);
                          }
                          span.setStatus({ code: SpanStatusCode.ERROR });
                        }

                        return result;
                      } catch (error) {
                        if (error instanceof Error) {
                          span.recordException(error);
                        }
                        span.setStatus({ code: SpanStatusCode.ERROR });
                        throw error;
                      } finally {
                        span.end();
                      }
                    },
                  ),
                );
              },
            } as Plugin)
          : false,
      ].filter(Boolean),
    });
  };

  const createSofa = async (
    args: Omit<Parameters<typeof useSofa>[0], "schema" | "context">,
  ) => {
    const { useSofa: useSofaFn } = await import("sofa-api");
    if (args.openAPI) {
      merge(args.openAPI, sofaOpenAPIWebhookDocs);
    }
    if (args.errorHandler) {
      const originalHandler = args.errorHandler;
      args.errorHandler = (errors) => {
        const span = trace.getActiveSpan();

        for (const error of errors) {
          span?.recordException(error);
        }
        span?.setStatus({ code: SpanStatusCode.ERROR });
        return originalHandler(errors);
      };
    }
    return useSofaFn({
      ...args,
      schema: builtSchema(),
      context,
      errorHandler(errors) {
        const span = trace.getActiveSpan();

        for (const error of errors) {
          span?.recordException(error);
        }
        span?.setStatus({ code: SpanStatusCode.ERROR });

        return new Response(errors[0].message, {
          status: 500,
        }) as any;
      },
    });
  };

  const createWs = <
    Options extends ServerOptions<any, any>,
    Rest extends unknown[],
    Return,
  >(
    implementation: (options: Options, ...rest: Rest) => Return,
    args: Omit<Options, "schema" | "context">,
    ...rest: Rest
  ): Return => {
    return implementation(
      {
        ...args,
        schema: builtSchema(),
        context,
      } as Options,
      ...rest,
    );
  };

  const clientCreator = clientCreatorImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
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
     * import { createServer } from "node:http";
     * const server = createServer(createYoga());
     * server.listen(3000, () => {
     *   console.info("Visit http://localhost:3000/graphql");
     * });
     * ```
     * https://the-guild.dev/graphql/yoga-server/docs#server
     */
    createYoga,
    /**
     * Creates a sofa instance to offer a REST API.
     *
     * ```ts
     * import express from "express";
     *
     * const app = express();
     * const sofa = createSofa(...);
     *
     * app.use("/api", useSofa({ schema }));
     * ```
     * https://the-guild.dev/graphql/sofa-api/docs#usage
     */
    createSofa,
    /**
     * Creates a WebSocket server handler for GraphQL subscriptions.
     * Pass the ws implementation function as the first argument and rumble will
     * inject the schema and context automatically.
     *
     * @example
     *
     * ```ts
     * // ws
     * import { useServer } from "graphql-ws/use/ws";
     * import { WebSocketServer } from "ws";
     * const wss = new WebSocketServer({ port: 4000 });
     * const disposable = createWs(useServer, { ... }, wss);
     *
     * // bun
     * import { makeHandler } from "graphql-ws/use/bun";
     * Bun.serve({ websocket: createWs(makeHandler, { ... }), ... });
     * ```
     */
    createWs,
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
    /**
     * The generated GraphQL schema. You can use this for example to create a GraphQL server with a different library than Yoga or to generate types with codegen.
     * When calling this function, the schema will be built for the first time and cached for later usage. So you can call this function multiple times without performance issues.
     * After calling, you cannot adjust the schema via the schema builder
     */
    buildSchema: builtSchema,
  };
};
