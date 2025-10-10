import { toCamelCase } from "drizzle-orm/casing";
import { capitalize } from "es-toolkit";
import { type EnumImplementerType, isEnumSchema } from "../enum";
import { mapSQLTypeToGraphQLType } from "../helpers/sqlTypes/mapSQLTypeToTSType";
import type { PossibleSQLType } from "../helpers/sqlTypes/types";
import { tableHelper } from "../helpers/tableHelpers";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "../types/rumbleInput";
import type { SchemaBuilderType } from "../types/schemaBuilderType";

// TODO: in general, several of the filter methods should be more
// restrictive in case of explicitly allowed columns
// search, order and filter should be restricted to allowed cols
// and should completely ignore other fields since one might be ably
// to narrow down and guess the actual values behind forbidden columns by
// using the provided args. This way one could guess, e.g. secrets which are forbidden by
// the column abilitiy settings but will be respected in searches, etc.

export type WhereArgImplementerType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
  typeof createWhereArgImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    SchemaBuilderType<UserContext, DB, RequestEvent, Action, PothosConfig>,
    EnumImplementerType<UserContext, DB, RequestEvent, Action, PothosConfig>
  >
>;

const makeDefaultName = (dbName: string) =>
  `${capitalize(toCamelCase(dbName.toString()))}WhereInputArgument`;

export const createWhereArgImplementer = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  SchemaBuilder extends SchemaBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >,
  EnumImplementer extends EnumImplementerType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >,
>({
  db,
  schemaBuilder,
  enumImplementer,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  enumImplementer: EnumImplementer;
  schemaBuilder: SchemaBuilder;
}) => {
  const referenceStorage = new Map<string, any>();

  const whereArgImplementer = <
    TableName extends keyof DrizzleQueryFunction<DB>,
    RefName extends string,
  >({
    table,
    refName,
    dbName,
  }: Partial<{
    table: TableName;
    refName: RefName | undefined;
    dbName: string;
  }> &
    (
      | {
          table: TableName;
        }
      | {
          dbName: string;
        }
    )) => {
    const tableSchema = tableHelper({
      db,
      table: dbName ?? table!,
    });

    const inputTypeName = refName ?? makeDefaultName(tableSchema.tsName);

    let ret: ReturnType<typeof implement> | undefined =
      referenceStorage.get(inputTypeName);
    if (ret) {
      return ret;
    }

    const implement = () => {
      return schemaBuilder.inputType(inputTypeName, {
        fields: (t) => {
          const mapSQLTypeStringToInputPothosType = (
            sqlType: PossibleSQLType,
            fieldName: string,
          ) => {
            const gqlType = mapSQLTypeToGraphQLType({
              sqlType,
              fieldName,
            });
            switch (gqlType) {
              case "Int":
                return t.field({ type: "IntWhereInputArgument" });
              case "String":
                return t.field({ type: "StringWhereInputArgument" });
              case "Boolean":
                return t.boolean({ required: false });
              case "Date":
                return t.field({
                  type: "DateWhereInputArgument",
                });
              case "DateTime":
                return t.field({
                  type: "DateWhereInputArgument",
                });
              case "Float":
                return t.field({
                  type: "FloatWhereInputArgument",
                });
              case "ID":
                return t.id({ required: false });
              case "JSON":
                return t.field({
                  type: "JSON",
                  required: false,
                });
              default:
                throw new RumbleError(
                  `Unsupported argument type ${gqlType} for column ${sqlType}`,
                );
            }
          };
          const fields = Object.entries(tableSchema.columns).reduce(
            (acc, [key, value]) => {
              if (isEnumSchema(value)) {
                const enumImpl = enumImplementer({
                  enumColumn: value,
                });

                acc[key] = t.field({
                  type: enumImpl,
                  required: false,
                });
              } else {
                acc[key] = mapSQLTypeStringToInputPothosType(
                  value.getSQLType() as PossibleSQLType,
                  key,
                );
              }

              return acc;
            },
            {} as Record<
              keyof typeof tableSchema.columns,
              ReturnType<typeof mapSQLTypeStringToInputPothosType>
            >,
          );

          const relations = Object.entries(tableSchema.relations ?? {}).reduce(
            (acc, [key, value]) => {
              const relationSchema = tableHelper({
                db,
                table: (value as any).targetTable,
              });
              const referenceModel = whereArgImplementer({
                dbName: relationSchema.dbName,
              });

              acc[key] = t.field({
                type: referenceModel,
                required: false,
              });

              return acc;
            },
            {} as Record<
              keyof typeof tableSchema.columns,
              ReturnType<typeof mapSQLTypeStringToInputPothosType>
            >,
          );

          return {
            ...fields,
            ...relations,
          };
        },
      });
    };

    ret = implement();
    referenceStorage.set(inputTypeName, ret);
    return ret;
  };

  return whereArgImplementer;
};
