import { type Column, is } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
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
 * Checks if a column is a Postgres enum column.
 *
 * Drizzle 1.0 exposes two enum column classes:
 * - `PgEnumColumn` for array-style enums: `pgEnum("name", ["a", "b"])`
 * - `PgEnumObjectColumn` for object-style enums: `pgEnum("name", { A: "a" })`
 *
 * Both expose the same `enum` and `enumValues` properties.
 */
export function isEnumSchema(
  schemaType: any,
): schemaType is PgEnumColumn<any> | PgEnumObjectColumn<any> {
  // TODO: make this compatible with other db drivers
  return is(schemaType, PgEnumColumn) || is(schemaType, PgEnumObjectColumn);
}

// TODO make this compatible with other db drivers
type EnumTypes = PgEnum<any> | PgEnumObject<any>;

export type NonEnumFields<T> = {
  [K in keyof T as T[K] extends EnumTypes ? never : K]: T[K];
};

/**
 * Picks the keys of a schema object that are pgEnum definitions
 * (either array-style `PgEnum` or object-style `PgEnumObject`).
 */
export type EnumFields<S> = {
  [K in keyof S as S[K] extends EnumTypes ? K : never]: S[K];
};

export type EnumImplementerType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  Schema extends Record<string, any>,
> = ReturnType<
  typeof createEnumImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    Schema,
    SchemaBuilderType<
      UserContext,
      DB,
      RequestEvent,
      Action,
      PothosConfig,
      Schema
    >
  >
>;

export const createEnumImplementer = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  Schema extends Record<string, any>,
  SchemaBuilder extends SchemaBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    Schema
  >,
>({
  schema,
  schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig, Schema> & {
  schemaBuilder: SchemaBuilder;
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
    TsName extends keyof EnumFields<Schema> & string,
    EnumColumn extends Column,
    RefName extends string,
  >(
    args: {
      refName?: RefName;
    } & (
      | { tsName: TsName; enum?: never; enumColumn?: never }
      | {
          enum: PgEnum<any> | PgEnumObject<any>;
          tsName?: never;
          enumColumn?: never;
        }
      | { enumColumn: EnumColumn; tsName?: never; enum?: never }
    ),
  ) => {
    const { refName } = args;
    const tsName = (args as { tsName?: string }).tsName;
    const enumObjectArg = (args as { enum?: PgEnum<any> | PgEnumObject<any> })
      .enum;
    const enumColumn = (args as { enumColumn?: EnumColumn }).enumColumn;

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

    if (!enumSchemaName || !enumValues) {
      throw new RumbleError("Could not determine enum structure!");
    }

    const graphqlImplementationName =
      refName ?? `${capitalize(toCamelCase(enumSchemaName))}Enum`;

    let ret: ReturnType<typeof implement> | undefined = referenceStorage.get(
      graphqlImplementationName,
    );
    if (ret) {
      return ret;
    }

    const implement = () =>
      schemaBuilder.enumType(graphqlImplementationName, {
        values: enumValues,
      });

    ret = implement();
    referenceStorage.set(graphqlImplementationName, ret);
    return ret;
  };

  return enumImplementer;
};
