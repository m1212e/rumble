import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import SmartSubscriptionsPlugin, {
  subscribeOptionsFromIterator,
} from "@pothos/plugin-smart-subscriptions";
import {
  DateResolver,
  DateTimeISOResolver,
  JSONResolver,
} from "graphql-scalars";
import type { createPubSub } from "graphql-yoga";
import {
  type DateWhereInputArgument,
  implementDefaultWhereInputArgs,
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
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  pubsub: ReturnType<typeof createPubSub>;
}) => {
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
    };
    DefaultFieldNullability: false;
  }>({
    ...pothosConfig,
    plugins: [
      pluginName,
      DrizzlePlugin,
      SmartSubscriptionsPlugin,
      ...(pothosConfig?.plugins ?? []),
    ],
    drizzle: {
      client: db,
      relations: db._.relations,
      getTableConfig(table) {
        //TODO support composite primary keys
        return {
          columns: Object.values((table as any)[Symbol.for("drizzle:Columns")]),
          primaryKeys: Object.values(
            (table as any)[Symbol.for("drizzle:Columns")],
          ).filter((v: any) => v.primary),
        } as any;
      },
    },
    smartSubscriptions: {
      ...subscribeOptionsFromIterator((name, _context) => {
        return pubsub.subscribe(name);
      }),
    },
    defaultFieldNullability: false,
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
