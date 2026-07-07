import { toCamelCase } from "drizzle-orm/casing";
import { capitalize } from "es-toolkit";
import { lazy } from "../helpers/lazy";
import { tableHelper } from "../helpers/tableHelpers";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
} from "../types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "../types/rumbleInput";
import type { SchemaBuilderType } from "../types/schemaBuilderType";

export type OrderArgImplementerType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
  typeof createOrderArgImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >
>;

const makeDefaultName = (dbName: string) =>
  `${capitalize(toCamelCase(dbName.toString()))}OrderInputArgument`;

export const createOrderArgImplementer = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>({
  db,
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

  const sortingParameterEnumRef = lazy(() =>
    schemaBuilder.enumType("SortingParameter", {
      values: ["asc", "desc"] as const,
    }),
  );

  const orderArgImplementer = <
    RefName extends string,
    TableName extends keyof DrizzleQueryFunction<DB>,
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
          // Drizzle's relationsOrderToSQL treats every key as a column on the
          // current table, so exposing relation keys would generate invalid SQL.
          const fields = Object.entries(tableSchema.columns).reduce(
            (acc, [key]) => {
              // GraphQL reserves names starting with "__" for introspection.
              if (key.startsWith("__")) return acc;

              acc[key] = t.field({
                type: sortingParameterEnumRef(),
                required: false,
              });

              return acc;
            },
            {} as Record<string, ReturnType<typeof t.field>>,
          );

          return fields;
        },
      });
    };

    ret = implement();
    referenceStorage.set(inputTypeName, ret);
    return ret;
  };

  return orderArgImplementer;
};
