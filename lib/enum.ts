import { type Column, getTableName, is, isTable } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
import { MySqlEnumColumn, MySqlEnumObjectColumn } from "drizzle-orm/mysql-core";
import {
  isPgEnum,
  type PgEnum,
  PgEnumColumn,
  type PgEnumObject,
  PgEnumObjectColumn,
} from "drizzle-orm/pg-core";
import { capitalize } from "es-toolkit";
import type { DrizzleInstance } from "./types/drizzleInstanceType";
import { RumbleError } from "./types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";
import type { SchemaBuilderType } from "./types/schemaBuilderType";

/**
 * Checks if a column is a database enum column (Postgres or MySQL).
 */
export function isEnumSchema(
  schemaType: any,
): schemaType is
  | PgEnumColumn<any>
  | PgEnumObjectColumn<any>
  | MySqlEnumColumn<any>
  | MySqlEnumObjectColumn<any> {
  return (
    is(schemaType, PgEnumColumn) ||
    is(schemaType, PgEnumObjectColumn) ||
    is(schemaType, MySqlEnumColumn) ||
    is(schemaType, MySqlEnumObjectColumn)
  );
}

// TODO make this compatible with other db drivers
type EnumTypes = PgEnum<any> | PgEnumObject<any>;

export type NonEnumFields<T> = {
  [K in keyof T as T[K] extends EnumTypes ? never : K]: T[K];
};

/**
 * Picks the keys of a schema object that are pgEnum definitions
 */
export type EnumFieldKeys<S> = keyof {
  [K in keyof S as S[K] extends EnumTypes ? K : never]: S[K];
};

/**
 * Fallback value tuple used whenever the concrete enum members cannot be
 * recovered from the drizzle types (e.g. an object-enum whose values were
 * widened to `string`, or a `tsName` that does not resolve against `Schema`).
 */
type UnknownEnumValues = readonly [string, ...string[]];

/**
 * Extracts the literal value tuple carried by a drizzle enum definition.
 */
type EnumValuesOf<E> =
  E extends PgEnum<infer V>
    ? V
    : E extends PgEnumObject<infer O>
      ? ReadonlyArray<O[keyof O] & string>
      : UnknownEnumValues;

/**
 * The GraphQL enum member union for a single `enum_(...)` call, resolved from
 * whichever of the three per-call generics the caller populated (`tsName` /
 * `enum` / `enumColumn`). The unused generics default to `never`, so
 * `[X] extends [never]` tells us which identification form was used.
 *
 * Anything we can't recover from the drizzle types (an object-enum widened to
 * `string`, or a `tsName` that doesn't resolve against `Schema`) falls back to
 * `string`, matching Pothos' own enum member type.
 */
type EnumMembers<Schema, TsName, EnumArg, EnumColumn> = [EnumColumn] extends [
  never,
]
  ? [EnumArg] extends [never]
    ? [TsName] extends [never]
      ? string
      : TsName extends keyof Schema
        ? EnumValuesOf<Schema[TsName]>[number]
        : string
    : EnumValuesOf<EnumArg>[number]
  : EnumColumn extends { enumValues: infer CV extends UnknownEnumValues }
    ? CV[number]
    : string;

/**
 * The strongly typed Pothos enum ref returned by a single `enum_(...)` call.
 *
 * Kept as a named, exported alias on purpose: the `.d.ts` emitter prints type
 * aliases by reference rather than expanding their bodies, so the (otherwise
 * very deep) `SchemaBuilder` / `EnumRef` types never get inlined into the
 * declaration output. Two details keep this printable without the emitter
 * recursing: referencing `SchemaBuilderType<...>` (a named alias) rather than
 * `typeof schemaBuilder` (a value), and inlining the member resolution so the
 * cyclic drizzle `Schema[TsName]` access never surfaces as its own symbol.
 */
export type EnumImplementationRef<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  Schema,
  TsName,
  EnumArg,
  EnumColumn,
> =
  SchemaBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  > extends PothosSchemaTypes.SchemaBuilder<infer Types>
    ? PothosSchemaTypes.EnumRef<
        Types,
        EnumMembers<Schema, TsName, EnumArg, EnumColumn>
      >
    : never;

export type EnumImplementerType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  AvailableEnums extends string,
  Schema extends Record<string, any> = Record<string, any>,
> = ReturnType<
  typeof createEnumImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    AvailableEnums,
    Schema
  >
>;

export const createEnumImplementer = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  AvailableEnums extends string,
  Schema extends Record<string, any> = Record<string, any>,
>({
  schema,
  schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  schemaBuilder: SchemaBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >;
}) => {
  const referenceStorage = new Map<string, any>();

  /**
   * Registers a Postgres enum as a GraphQL enum type.
   *
   * You can identify the enum in three ways:
   * - `tsName`: the exported TypeScript identifier from your schema module. This is the
   *   most typesafe form, only valid enum keys autocomplete, typos are caught at compile time.
   * - `enum`: pass the pgEnum object directly.
   * - `enumColumn`: pass a column that uses the enum.
   *
   * Use `refName` to override the auto-generated GraphQL type name.
   */
  const enumImplementer = <
    TsName extends AvailableEnums = never,
    EnumArg extends PgEnum<any> | PgEnumObject<any> = never,
    EnumColumn extends Column = never,
    RefName extends string = string,
  >(
    args: {
      refName?: RefName;
    } & (
      | { tsName: TsName; enum?: never; enumColumn?: never }
      | { enum: EnumArg; tsName?: never; enumColumn?: never }
      | { enumColumn: EnumColumn; tsName?: never; enum?: never }
    ),
  ): EnumImplementationRef<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    Schema,
    TsName,
    EnumArg,
    EnumColumn
  > => {
    const { refName } = args;
    const tsName = (args as { tsName?: string }).tsName;
    const enumObjectArg = (args as { enum?: PgEnum<any> | PgEnumObject<any> })
      .enum;
    const enumColumn = (args as { enumColumn?: Column }).enumColumn;

    let enumObject: PgEnum<any> | PgEnumObject<any> | undefined = enumObjectArg;

    if (tsName) {
      const candidate = (schema as Record<string, unknown>)[tsName];
      if (!candidate || !isPgEnum(candidate as any)) {
        throw new RumbleError(
          `Could not find a pgEnum exported as ${JSON.stringify(
            tsName,
          )} in the provided schema. ` +
            `Make sure the identifier exists and refers to a value created with \`pgEnum(...)\`.`,
        );
      }
      enumObject = candidate as PgEnum<any> | PgEnumObject<any>;
    }

    if (!enumObject && !enumColumn) {
      throw new RumbleError(
        `Could not determine enum structure! Pass one of 'tsName' (requires \`schema\` on rumble()), ` +
          `'enum' (the pgEnum object), or 'enumColumn' (a column that uses the enum).`,
      );
    }

    let enumSchemaName: string | undefined;
    let enumValues: any[] | undefined;

    if (enumObject) {
      enumSchemaName = enumObject.enumName;
      enumValues = enumObject.enumValues as unknown as any[];
    } else if (enumColumn) {
      // MySQL enum columns carry their values directly; there is no standalone
      // enum object. Derive a stable name from table + column name.
      if (
        is(enumColumn, MySqlEnumColumn) ||
        is(enumColumn, MySqlEnumObjectColumn)
      ) {
        enumValues = (enumColumn as any).enumValues as unknown as any[];
        const colTable = (enumColumn as any).table;
        const tableName =
          colTable && isTable(colTable) ? getTableName(colTable) : undefined;
        enumSchemaName = tableName
          ? `${tableName}_${enumColumn.name}`
          : enumColumn.name;
      } else {
        const pgEnum = (enumColumn as any).enum as
          | PgEnum<any>
          | PgEnumObject<any>
          | undefined;

        if (!pgEnum) {
          throw new RumbleError(
            `Could not find enum definition on column. Make sure the column is a pgEnum column.`,
          );
        }

        enumSchemaName = pgEnum.enumName;
        enumValues = enumColumn.enumValues as unknown as any[];
      }
    }

    if (!enumSchemaName || !enumValues) {
      throw new RumbleError("Could not determine enum structure!");
    }

    const graphqlImplementationName =
      refName ?? `${capitalize(toCamelCase(enumSchemaName))}Enum`;

    // The runtime always produces a plain Pothos enum ref; the strong typing
    // lives entirely in the (explicit, named) return type, so we cast on the
    // way out. The named return alias is what keeps the `.d.ts` emitter from
    // recursing on the inlined SchemaBuilder/EnumRef types.
    type Ret = EnumImplementationRef<
      UserContext,
      DB,
      RequestEvent,
      Action,
      PothosConfig,
      Schema,
      TsName,
      EnumArg,
      EnumColumn
    >;

    const cached = referenceStorage.get(graphqlImplementationName);
    if (cached) {
      return cached as Ret;
    }

    const ret = schemaBuilder.enumType(graphqlImplementationName, {
      values: enumValues,
    });
    referenceStorage.set(graphqlImplementationName, ret);
    return ret as unknown as Ret;
  };

  return enumImplementer;
};
