import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import SmartSubscriptionsPlugin, {
  subscribeOptionsFromIterator,
} from "@pothos/plugin-smart-subscriptions";
import TracingPlugin, {
  isRootField,
  wrapResolver,
} from "@pothos/plugin-tracing";
import { createOpenTelemetryWrapper } from "@pothos/tracing-opentelemetry";
import { getTableColumns, isTable, type Table } from "drizzle-orm";
import {
  DateResolver,
  DateTimeISOResolver,
  JSONResolver,
} from "graphql-scalars";
import type { createPubSub } from "graphql-yoga";
import {
  type BooleanWhereInputArgument,
  type DateWhereInputArgument,
  type IDWhereInputArgument,
  implementDefaultWhereInputArgs,
  type JSONWhereInputArgument,
  type NumberWhereInputArgument,
  type StringWhereInputArgument,
} from "./args/whereArgsImplementer";
import type { ContextType } from "./context";
import { pluginName } from "./runtimeFiltersPlugin/filterTypes";
import { registerRuntimeFiltersPlugin } from "./runtimeFiltersPlugin/runtimeFiltersPlugin";
import type { DrizzleInstance } from "./types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";

export const createSchemaBuilder = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>({
  db,
  disableDefaultObjects,
  pubsub,
  pothosConfig,
  otel,
  logger,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  pubsub: ReturnType<typeof createPubSub>;
}) => {
  const createSpan =
    otel?.enabled && otel.tracer
      ? createOpenTelemetryWrapper(otel.tracer, otel.options)
      : undefined;

  registerRuntimeFiltersPlugin();
  const schemaBuilder = new SchemaBuilder<{
    Context: ContextType<UserContext, DB, RequestEvent, Action, PothosConfig>;
    DrizzleRelations: DB["_"]["relations"];
    Scalars: {
      JSON: {
        Input: unknown;
        Output: unknown;
      };
      Date: {
        Input: Date;
        Output: Date;
      };
      DateTime: {
        Input: Date;
        Output: Date;
      };
    };
    Inputs: {
      IntWhereInputArgument: NumberWhereInputArgument;
      FloatWhereInputArgument: NumberWhereInputArgument;
      StringWhereInputArgument: StringWhereInputArgument;
      DateWhereInputArgument: DateWhereInputArgument;
      BooleanWhereInputArgument: BooleanWhereInputArgument;
      IDWhereInputArgument: IDWhereInputArgument;
      JSONWhereInputArgument: JSONWhereInputArgument;
    };
    DefaultFieldNullability: false;
  }>({
    ...pothosConfig,
    plugins: [
      pluginName,
      DrizzlePlugin,
      SmartSubscriptionsPlugin,
      TracingPlugin,
      ...(pothosConfig?.plugins ?? []),
    ],
    drizzle: {
      client: db,
      relations: db._.relations,
      getTableConfig(table) {
        //TODO support composite primary keys
        const columns = isTable(table)
          ? Object.values(getTableColumns(table as Table))
          : [];
        return {
          columns,
          primaryKeys: columns.filter((v: any) => v.primary),
        } as any;
      },
    },
    smartSubscriptions: {
      ...subscribeOptionsFromIterator((name, _context) => {
        return pubsub.subscribe(name);
      }),
    },
    defaultFieldNullability: false,
    tracing: {
      default:
        otel?.enabled || logger?.enabled
          ? (config) => isRootField(config)
          : () => false,
      wrap: (resolver, options, config) => {
        let r = createSpan ? createSpan(resolver, options) : resolver;
        if (logger?.enabled) {
          const log = logger.logger;
          r = wrapResolver(r, (error, duration) => {
            if (error) {
              log.error(
                {
                  "graphql.field.name": config.name,
                  "graphql.parent.type": config.parentType,
                  durationMs: duration,
                  err: error,
                },
                "resolver failed",
              );
            } else {
              log.debug(
                {
                  "graphql.field.name": config.name,
                  "graphql.parent.type": config.parentType,
                  durationMs: duration,
                },
                "resolver completed",
              );
            }
          });
        }
        return r;
      },
    },
    otel,
    logger,
  });

  schemaBuilder.addScalarType("JSON", JSONResolver);
  schemaBuilder.addScalarType("Date", DateResolver);
  schemaBuilder.addScalarType("DateTime", DateTimeISOResolver);
  implementDefaultWhereInputArgs(schemaBuilder);

  if (!disableDefaultObjects?.query) {
    schemaBuilder.queryType({});
  }

  if (!disableDefaultObjects?.subscription) {
    schemaBuilder.subscriptionType({});
  }

  if (!disableDefaultObjects?.mutation) {
    schemaBuilder.mutationType({});
  }

  return { schemaBuilder };
};
