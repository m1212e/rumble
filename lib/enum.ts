import { toCamelCase } from "drizzle-orm/casing";
import { type PgEnum, PgEnumColumn } from "drizzle-orm/pg-core";
import { capitalize } from "es-toolkit";
import type { DrizzleInstance } from "./types/drizzleInstanceType";
import { RumbleError } from "./types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";
import type { SchemaBuilderType } from "./types/schemaBuilderType";

/**
 * Checks if a column is a PgEnumColumn
 */
export function isEnumSchema(schemaType: any): schemaType is PgEnumColumn<any> {
  // TODO: make this compatible with other db drivers
  return schemaType instanceof PgEnumColumn;
}

// TODO make this compatible with other db drivers
type EnumTypes = PgEnum<any>;

export type NonEnumFields<T> = {
  [K in keyof T as T[K] extends EnumTypes ? never : K]: T[K];
};

export type EnumImplementerType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
  typeof createEnumImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    SchemaBuilderType<UserContext, DB, RequestEvent, Action, PothosConfig>
  >
>;

export const createEnumImplementer = <
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
>({
  schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  schemaBuilder: SchemaBuilder;
}) => {
  const referenceStorage = new Map<string, any>();

  /**
   * Registers a Postgres enum as a GraphQL enum type.
   *
   * Pass the `enum` option with the pgEnum object (e.g. `moodEnum`),
   * or pass the `enumColumn` option with a column that uses the enum.
   * Use `refName` to override the auto-generated GraphQL type name.
   */
  const enumImplementer = <
    EnumColumn extends PgEnumColumn<any>,
    RefName extends string,
  >({
    enum: enumObject,
    enumColumn,
    refName,
  }: {
    refName?: RefName;
  } & (
    | { enum: PgEnum<any>; enumColumn?: never }
    | { enumColumn: EnumColumn; enum?: never }
  )) => {
    let enumSchemaName: string | undefined;
    let enumValues: any[] | undefined;

    if (enumObject) {
      enumSchemaName = enumObject.enumName;
      enumValues = enumObject.enumValues;
    } else if (enumColumn) {
      const pgEnum = (enumColumn as any).enum as PgEnum<any> | undefined;

      if (!pgEnum) {
        throw new RumbleError(
          `Could not find enum definition on column. Make sure the column is a pgEnum column.`,
        );
      }

      enumSchemaName = pgEnum.enumName;
      enumValues = enumColumn.enumValues;
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
