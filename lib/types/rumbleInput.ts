import type { Tracer } from "@opentelemetry/api";
import type SchemaBuilder from "@pothos/core";
import type { TracingWrapperOptions } from "@pothos/tracing-opentelemetry";
import type { createPubSub } from "graphql-yoga";
import type { DrizzleInstance } from "./drizzleInstanceType";

export interface RumbleLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  child(bindings: Record<string, unknown>): RumbleLogger;
}

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
  Schema extends Record<string, any> = Record<string, any>,
> = {
  /**
   * Your drizzle database instance
   */
  db: DB;
  /**
   * The drizzle schema object (the same one passed to `defineRelations`).
   */
  schema: Schema;
  /**
   * A function for providing context for each request based on the incoming HTTP Request.
   * The type of the parameter equals the HTTPRequest type of your chosen server.
   */
  context?:
    | ((event: RequestEvent) => Promise<UserContext> | UserContext)
    | undefined;
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
         * The cuttoff factor to reduce the amount of returned results.
         * Defaults to 0.3. Lower values will return more results.
         */
        threshold?: number;
        /**
         * Will perform a local
         * SET cpu_operator_cost = x;
         * for search queries. This can help to make the planner
         * use a potential index scan instead of a sequential scan.
         * This will not affect queries that are not using the search feature.
         */
        cpu_operator_cost?: number;
      }
    | undefined;
  /**
   * rumble can set up otel tracing if you want to. This will provide details of execution time and outcome to the provided tracer. See https://pothos-graphql.dev/docs/plugins/tracing#install for more information.
   *
   * The emitted spans and attributes are identical for every transport, so an
   * operation served via GraphQL, the SOFA REST adapter or WebSockets produces
   * the same trace shape (see `rumble.transport` to tell them apart).
   */
  otel?: {
    /**
     * Whether otel tracing should be enabled. This will create a tracer if none is provided.
     */
    enabled?: boolean;
    /**
     * The tracer to use. If enabled is true and no tracer is provided, a tracer will be created.
     */
    tracer?: Tracer;
    /**
     * You can pass options to the tracing wrapper
     */
    options?: TracingWrapperOptions<unknown>;
    /**
     * Whether the operation source is attached to operation spans as
     * `graphql.document`.
     *
     * Keep in mind that a document can carry inline argument literals, so this
     * may contain user data.
     * @default true
     */
    includeDocument?: boolean;
    /**
     * Whether the incoming operation variables are attached to operation spans
     * as `graphql.variables.<name>` attributes.
     *
     * Variables regularly carry personal data, so you can turn this off
     * entirely (`false`) or pass a function to redact or drop single entries
     * before they leave the process.
     *
     * @example
     * ```ts
     * otel: {
     *   enabled: true,
     *   includeVariables: ({ password, ...rest }) => rest,
     * }
     * ```
     * @default true
     */
    includeVariables?:
      | boolean
      | ((
          variables: Record<string, unknown>,
        ) => Record<string, unknown> | undefined);
  };
  /**
   * Structured logging for rumble internals. Pass a pino (or compatible) logger instance.
   * When enabled, rumble emits structured log entries for GraphQL operations, ability checks,
   * and runtime filter applications — queryable by level and field in Loki or similar.
   */
  logger?: {
    /**
     * Whether structured logging should be enabled.
     */
    enabled?: boolean;
    /**
     * The logger instance to use. Must satisfy the RumbleLogger interface (pino satisfies this).
     */
    logger: RumbleLogger;
    /**
     * When both logger and otel are enabled, inject `trace_id`, `span_id` and `trace_flags`
     * fields into every log entry emitted during a GraphQL operation. Useful for correlating
     * log lines with traces in backends like Jaeger or Grafana Tempo.
     * @default true
     */
    injectTraceId?: boolean;
    /**
     * Whether the incoming operation variables are attached to the operation
     * start log entry as a `graphql.variables` object.
     *
     * Variables regularly carry personal data, so you can turn this off
     * entirely (`false`) or pass a function to redact or drop single entries
     * before they are logged.
     *
     * @example
     * ```ts
     * logger: {
     *   enabled: true,
     *   logger: pino(),
     *   includeVariables: ({ password, ...rest }) => rest,
     * }
     * ```
     * @default true
     */
    includeVariables?:
      | boolean
      | ((
          variables: Record<string, unknown>,
        ) => Record<string, unknown> | undefined);
  };
};
