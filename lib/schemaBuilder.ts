import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import SmartSubscriptionsPlugin, {
  subscribeOptionsFromIterator,
} from "@pothos/plugin-smart-subscriptions";
import TracingPlugin, {
  isRootField,
  wrapResolver,
} from "@pothos/plugin-tracing";
import ValidationPlugin from "@pothos/plugin-validation";
import { createOpenTelemetryWrapper } from "@pothos/tracing-opentelemetry";
import { getTableColumns, is, isTable, type Table } from "drizzle-orm";
import {
  MySqlTable,
  getTableConfig as mysqlTableConfig,
} from "drizzle-orm/mysql-core";
import { PgTable, getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import {
  SQLiteTable,
  getTableConfig as sqliteTableConfig,
} from "drizzle-orm/sqlite-core";
import {
  BigIntResolver,
  ByteResolver,
  DateResolver,
  DateTimeISOResolver,
  JSONResolver,
  LocaleResolver,
} from "graphql-scalars";
import type { createPubSub } from "graphql-yoga";
import type { PhoneNumber as LibPhoneNumber } from "libphonenumber-js";
import type { AbilityBuilderType } from "./abilityBuilder";
import {
  type BigIntWhereInputArgument,
  type BooleanWhereInputArgument,
  type DateTimeWhereInputArgument,
  type DateWhereInputArgument,
  type IDWhereInputArgument,
  implementDefaultWhereInputArgs,
  type JSONWhereInputArgument,
  type NumberWhereInputArgument,
  type StringWhereInputArgument,
} from "./args/whereArgsImplementer";
import { registerColumnMaskPlugin } from "./columnMaskPlugin/columnMaskPlugin";
import { columnMaskPluginName } from "./columnMaskPlugin/maskTypes";
import type { ContextType } from "./context";
import { createAbilityAwareClient } from "./helpers/abilityAwareClient";
import { errorLogField } from "./helpers/errorLogging";
import {
  ATTR_FIELD_NAME,
  ATTR_PARENT_TYPE,
  FIELD_DURATION_MS,
  traceCorrelationFields,
} from "./helpers/telemetry";
import { pluginName } from "./runtimeFiltersPlugin/filterTypes";
import { registerRuntimeFiltersPlugin } from "./runtimeFiltersPlugin/runtimeFiltersPlugin";
import {
  type AddressInputShape,
  type AddressShape,
  implementDefaultAddressTypes,
} from "./scalars/address";
import { EmailAddressResolver } from "./scalars/emailAddress";
import { PersonNameResolver } from "./scalars/personName";
import { PhoneNumberResolver } from "./scalars/phoneNumber";
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
  pubsub,
  pothosConfig,
  otel,
  logger,
  validation,
  abilityBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  pubsub: ReturnType<typeof createPubSub>;
  abilityBuilder: AbilityBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >;
}) => {
  const createSpan =
    otel?.enabled && otel.tracer
      ? createOpenTelemetryWrapper(otel.tracer, otel.options)
      : undefined;

  registerRuntimeFiltersPlugin();
  registerColumnMaskPlugin();
  const schemaBuilder = new SchemaBuilder<{
    Context: ContextType<UserContext, DB, RequestEvent, Action, PothosConfig>;
    DrizzleRelations: DB["_"]["relations"];
    AsyncSelections: true;
    Objects: {
      Address: AddressShape;
    };
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
        Output: Date | string;
      };
      BigInt: {
        Input: bigint | number;
        Output: bigint | number | string;
      };
      Bytes: {
        Input: string;
        Output: string;
      };
      EmailAddress: {
        Input: string;
        Output: string;
      };
      PhoneNumber: {
        Input: LibPhoneNumber;
        Output: LibPhoneNumber | string;
      };
      Locale: {
        Input: string;
        Output: string;
      };
      PersonName: {
        Input: string;
        Output: string;
      };
    };
    Inputs: {
      IntWhereInputArgument: NumberWhereInputArgument;
      FloatWhereInputArgument: NumberWhereInputArgument;
      StringWhereInputArgument: StringWhereInputArgument;
      DateWhereInputArgument: DateWhereInputArgument;
      DateTimeWhereInputArgument: DateTimeWhereInputArgument;
      BigIntWhereInputArgument: BigIntWhereInputArgument;
      BooleanWhereInputArgument: BooleanWhereInputArgument;
      IDWhereInputArgument: IDWhereInputArgument;
      JSONWhereInputArgument: JSONWhereInputArgument;
      AddressInput: AddressInputShape;
    };
    DefaultFieldNullability: false;
  }>({
    ...pothosConfig,
    plugins: [
      // must wrap the runtime filters, so filters see unmasked rows
      columnMaskPluginName,
      pluginName,
      DrizzlePlugin,
      SmartSubscriptionsPlugin,
      TracingPlugin,
      ValidationPlugin,
      ...(pothosConfig?.plugins ?? []),
    ],
    drizzle: {
      // plugin-drizzle >=0.19.1 checks the client structurally against the
      // relations of the generic DB, which TS can't resolve for an unresolved DB
      // @ts-expect-error
      client: createAbilityAwareClient({ db, abilityBuilder }),
      relations: db._.relations,
      getTableConfig(table) {
        if (is(table, PgTable)) return pgTableConfig(table) as any;
        if (is(table, MySqlTable)) return mysqlTableConfig(table) as any;
        if (is(table, SQLiteTable)) return sqliteTableConfig(table) as any;
        return {
          columns: isTable(table)
            ? Object.values(getTableColumns(table as Table))
            : [],
          primaryKeys: [],
          uniqueConstraints: [],
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
          const telemetryConfig = { otel, logger };
          r = wrapResolver(r, (error, duration) => {
            const fields = {
              [ATTR_FIELD_NAME]: config.name,
              [ATTR_PARENT_TYPE]: config.parentType,
              [FIELD_DURATION_MS]: duration,
              // read from the active span, which at this point is the resolver
              // span pothos opened, so resolver logs correlate as precisely as
              // the operation level ones do
              ...traceCorrelationFields(telemetryConfig),
            };

            if (error) {
              log.error(
                { ...fields, ...errorLogField(error) },
                "resolver failed",
              );
            } else {
              log.debug(fields, "resolver completed");
            }
          });
        }
        return r;
      },
    },
    otel,
    logger,
    // `RumbleValidationConfig` is deliberately generic-unbound (extracted from the plugin's
    // own type, not hand-declared), so it doesn't line up with this builder's concrete
    // SchemaTypes — same category of mismatch `otel`/`logger`/`tracing` avoid by not
    // referencing Pothos generics at all.
    validation: validation as any,
  });

  schemaBuilder.addScalarType("JSON", JSONResolver);
  schemaBuilder.addScalarType("Date", DateResolver);
  schemaBuilder.addScalarType("DateTime", DateTimeISOResolver);
  schemaBuilder.addScalarType("BigInt", BigIntResolver);
  schemaBuilder.addScalarType("Bytes", ByteResolver);
  schemaBuilder.addScalarType("EmailAddress", EmailAddressResolver);
  schemaBuilder.addScalarType("PhoneNumber", PhoneNumberResolver);
  schemaBuilder.addScalarType("Locale", LocaleResolver);
  schemaBuilder.addScalarType("PersonName", PersonNameResolver);
  implementDefaultWhereInputArgs(schemaBuilder);
  implementDefaultAddressTypes(schemaBuilder);

  schemaBuilder.queryType({});
  schemaBuilder.subscriptionType({});
  schemaBuilder.mutationType({});

  return { schemaBuilder };
};
