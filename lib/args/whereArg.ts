import { is } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
import { PgColumn } from "drizzle-orm/pg-core";
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
    PothosConfig
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
>({
  db,
  schemaBuilder,
  enumImplementer,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  enumImplementer: EnumImplementerType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    any
  >;
  schemaBuilder: SchemaBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >;
}) => {
  const referenceStorage = new Map<string, any>();
  const enumArrayWhereInputStorage = new Map<string, any>();
  const scalarArrayWhereInputStorage = new Map<string, any>();

  const scalarArrayWhereInputName = (gqlType: string) =>
    `${gqlType}ArrayWhereInputArgument`;

  const getScalarArrayWhereInput = (gqlType: string) => {
    const typeName = scalarArrayWhereInputName(gqlType);
    const existing = scalarArrayWhereInputStorage.get(typeName);
    if (existing) return existing;

    const ret = schemaBuilder.inputRef(typeName);
    scalarArrayWhereInputStorage.set(typeName, ret);

    ret.implement({
      fields: (t: any) => ({
        eq: t.field({ type: [gqlType], required: false }),
        ne: t.field({ type: [gqlType], required: false }),
        in: t.field({ type: [[gqlType]], required: false }),
        notIn: t.field({ type: [[gqlType]], required: false }),
        isNull: t.boolean({ required: false }),
        isNotNull: t.boolean({ required: false }),
        arrayOverlaps: t.field({ type: [gqlType], required: false }),
        arrayContained: t.field({ type: [gqlType], required: false }),
        arrayContains: t.field({ type: [gqlType], required: false }),
        AND: t.field({ type: [ret], required: false }),
        OR: t.field({ type: [ret], required: false }),
        NOT: t.field({ type: ret, required: false }),
      }),
    });

    return ret;
  };

  const getEnumArrayWhereInput = (enumImpl: any) => {
    const typeName = `${enumImpl.name}WhereInputArgument`;

    const existing = enumArrayWhereInputStorage.get(typeName);
    if (existing) {
      return existing;
    }

    const ret = schemaBuilder.inputRef(typeName);
    enumArrayWhereInputStorage.set(typeName, ret);

    ret.implement({
      fields: (t: any) => ({
        // the column holds an array, so eq/ne compare against a whole
        // array value and in/notIn against a list of array values
        eq: t.field({ type: [enumImpl], required: false }),
        ne: t.field({ type: [enumImpl], required: false }),
        in: t.field({ type: [[enumImpl]], required: false }),
        notIn: t.field({ type: [[enumImpl]], required: false }),
        isNull: t.boolean({ required: false }),
        isNotNull: t.boolean({ required: false }),
        arrayOverlaps: t.field({ type: [enumImpl], required: false }),
        arrayContained: t.field({ type: [enumImpl], required: false }),
        arrayContains: t.field({ type: [enumImpl], required: false }),
        AND: t.field({ type: [ret], required: false }),
        OR: t.field({ type: [ret], required: false }),
        NOT: t.field({ type: ret, required: false }),
      }),
    });

    return ret;
  };

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

    const existing = referenceStorage.get(inputTypeName);
    if (existing) {
      return existing;
    }

    const ret = schemaBuilder.inputRef(inputTypeName);
    referenceStorage.set(inputTypeName, ret);

    ret.implement({
      fields: (t: any) => {
        const mapSQLTypeStringToInputPothosType = (
          sqlType: PossibleSQLType,
          fieldName: string,
          isArray: boolean,
        ) => {
          const gqlType = mapSQLTypeToGraphQLType({
            sqlType,
            fieldName,
          });

          if (isArray) {
            return t.field({
              type: getScalarArrayWhereInput(gqlType),
              required: false,
            });
          }

          switch (gqlType) {
            case "Int":
              return t.field({
                type: "IntWhereInputArgument",
                required: false,
              });
            case "BigInt":
              return t.field({
                type: "BigIntWhereInputArgument",
                required: false,
              });
            case "String":
              return t.field({
                type: "StringWhereInputArgument",
                required: false,
              });
            case "Boolean":
              return t.field({
                type: "BooleanWhereInputArgument",
                required: false,
              });
            case "Date":
              return t.field({
                type: "DateWhereInputArgument",
                required: false,
              });
            case "DateTime":
              return t.field({
                type: "DateTimeWhereInputArgument",
                required: false,
              });
            case "Float":
              return t.field({
                type: "FloatWhereInputArgument",
                required: false,
              });
            case "ID":
              return t.field({
                type: "IDWhereInputArgument",
                required: false,
              });
            case "JSON":
              return t.field({
                type: "JSONWhereInputArgument",
                required: false,
              });
            case "Bytes":
              // No meaningful filter operators for byte columns — skip.
              return null;
            default:
              throw new RumbleError(
                `Unsupported argument type ${gqlType} for column ${sqlType}`,
              );
          }
        };
        const fields = Object.entries(tableSchema.columns).reduce(
          (acc, [key, value]) => {
            // GraphQL reserves names starting with "__" for introspection.
            if (key.startsWith("__")) return acc;

            // Detect pg array columns via the `dimensions` runtime property.
            let isArray = false;
            if (is(value, PgColumn)) {
              const dims = (value as PgColumn & { dimensions?: number })
                .dimensions;
              if (dims && dims > 0) isArray = true;
            }

            if (isEnumSchema(value)) {
              const enumImpl = enumImplementer({
                enumColumn: value,
              });

              acc[key] = t.field({
                type: isArray ? getEnumArrayWhereInput(enumImpl) : enumImpl,
                required: false,
              });
            } else {
              const field = mapSQLTypeStringToInputPothosType(
                value.getSQLType() as PossibleSQLType,
                key,
                isArray,
              );
              if (field !== null) {
                acc[key] = field;
              }
            }

            return acc;
          },
          {} as Record<string, ReturnType<typeof t.field>>,
        );

        const relations = Object.entries(tableSchema.relations ?? {}).reduce(
          (acc, [key, value]) => {
            // `targetTableName` is the publicly typed TS-key of the target
            // relation in db._.relations, prefer it over re-resolving via
            // the `targetTable` object.
            const targetTsName = (value as any).targetTableName as string;
            const relationSchema = tableHelper({
              db,
              table: targetTsName,
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
          AND: t.field({ type: [ret], required: false }),
          OR: t.field({ type: [ret], required: false }),
          NOT: t.field({ type: ret, required: false }),
        };
      },
    });

    return ret;
  };

  return whereArgImplementer;
};
