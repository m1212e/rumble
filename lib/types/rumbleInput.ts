import type SchemaBuilder from "@pothos/core";
import type { createPubSub } from "graphql-yoga";
import type { DrizzleInstance } from "./drizzleInstanceType";

export type CustomRumblePothosConfig = Omit<
  ConstructorParameters<typeof SchemaBuilder>[0],
  "smartSubscriptions" | "drizzle"
>;

export type RumbleInput<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = {
  /**
   * Your drizzle database instance
   */
  db: DB;
  /**
   * A function for providing context for each request based on the incoming HTTP Request.
   * The type of the parameter equals the HTTPRequest type of your chosen server.
   */
  context?:
    | ((event: RequestEvent) => Promise<UserContext> | UserContext)
    | undefined;
  /**
   * If you only want to disable query, mutation or subscription default objects, you can do so here
   */
  disableDefaultObjects?: {
    mutation?: boolean;
    subscription?: boolean;
    query?: boolean;
  };
  /**
   * The actions that are available
   */
  actions?: Action[];
  /**
   * Customization for subscriptions. See https://the-guild.dev/graphql/yoga-server/docs/features/subscriptions#distributed-pubsub-for-production
   */
  subscriptions?: Parameters<typeof createPubSub>;
  /**
   * Options passed along to the pothos schema builder.
   */
  pothosConfig?: PothosConfig;
  /**
   * Limits the returned amount when querying lists. Set to null to disable.
   * @default 100
   */
  defaultLimit?: number | undefined | null;
  /**
   * rumble supports fuzzy search for the query helpers. This enables the users of your API to search for entities via fuzzy search inputs.
   * This currently only is supported by postgres databases and will fail if enabled on other dialects.
   *
   * Please note that this will install the pg_trgm extension on startup if your database does not have it already installed.
   * https://www.postgresql.org/docs/current/pgtrgm.html
   */
  search?:
    | {
        /**
         * Whether search is enabled
         */
        enabled?: boolean;
        /**
         * The threshold for cutting off non matching results. Defaults to 0.1. Lower = more results.
         */
        threshold?: number;
      }
    | undefined;
};
