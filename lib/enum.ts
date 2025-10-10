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

//TODO check if the enum find logic can be made more solid after drizzle reaches 1.0

/**
 * Checks if a schema type is an enum
 */
export function isEnumSchema(schemaType: any): schemaType is PgEnum<any> {
  // TODO make this compatible with other db drivers
  return schemaType instanceof PgEnumColumn;
}

// TODO make this compatible with other db drivers
type EnumTypes = PgEnum<any>;

type EnumFields<T> = {
  [K in keyof T as T[K] extends EnumTypes ? K : never]: T[K];
};

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
  db,
  schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  schemaBuilder: SchemaBuilder;
}) => {
  const referenceStorage = new Map<string, any>();

  const enumImplementer = <
    ExplicitEnumVariableName extends keyof EnumFields<
      NonNullable<DB["_"]["fullSchema"]>
    >,
    EnumColumn extends EnumTypes,
    RefName extends string,
  >({
    tsName,
    enumColumn,
    refName,
  }: Partial<{
    tsName: ExplicitEnumVariableName;
    enumColumn: EnumColumn;
    refName?: RefName | undefined;
  }> &
    (
      | {
          tsName: ExplicitEnumVariableName;
        }
      | {
          enumColumn: EnumColumn;
        }
    )) => {
    //TODO check if this can be done typesafe

    let enumSchemaName: string | undefined;
    let enumValues: any[] | undefined;

    if (tsName) {
      const schemaEnum = db._.fullSchema![tsName as string];

      enumSchemaName = tsName.toString();

      const enumCol = Object.values(db._.schema!)
        .filter((s) => typeof s === "object")
        .map((s) => Object.values(s.columns))
        .flat(2)
        .filter(isEnumSchema)
        .find((e: any) => e.config.enum === schemaEnum);

      if (!enumCol) {
        throw new RumbleError(`Could not find applied enum column for ${tsName.toString()}.
Please ensure that you use the enum at least once as a column of a table!`);
      }

      enumValues = (enumCol as any).enumValues;
    } else if (enumColumn) {
      enumSchemaName = (enumColumn as any).config.name as string;
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
