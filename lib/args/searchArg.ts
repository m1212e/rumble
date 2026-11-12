import { toCamelCase } from "drizzle-orm/casing";
import { capitalize } from "es-toolkit";
import { tableHelper } from "../helpers/tableHelpers";
import { type SearchColumnRegistry, serverSearchColumnKeys } from "../search";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "../types/rumbleInput";
import type { SchemaBuilderType } from "../types/schemaBuilderType";

/** The `search` argument as a resolver receives it */
export type SearchArg = {
  term: string;
  fields?: string[] | null;
};

export type SearchArgImplementerType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
  typeof createSearchArgImplementer<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >
>;

export const createSearchArgImplementer = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>({
  db,
  search,
  schemaBuilder,
  searchColumns,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  schemaBuilder: SchemaBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >;
  searchColumns: SearchColumnRegistry;
}) => {
  const referenceStorage = new Map<string, any>();

  /**
   * The input type of a table's `search` argument, `undefined` when search is
   * off for it or it has nothing to search. Call it only while the schema is
   * built (inside a fields callback): the enum lists the columns the table's
   * object names, and every object has to be registered by then.
   */
  return ({ dbName }: { dbName: string }) => {
    const tableSchema = tableHelper({ db, table: dbName });
    if (!search?.enabled || !searchColumns.isEnabled(tableSchema.tsName)) {
      return undefined;
    }
    const baseName = capitalize(toCamelCase(tableSchema.tsName));
    const inputTypeName = `${baseName}SearchInputArgument`;

    if (referenceStorage.has(inputTypeName)) {
      return referenceStorage.get(inputTypeName);
    }

    // GraphQL reserves names starting with "__" and an enum needs a value
    const columnKeys = serverSearchColumnKeys({
      tableSchema,
      searchColumns,
    }).filter((key) => !key.startsWith("__"));
    if (columnKeys.length === 0) {
      referenceStorage.set(inputTypeName, undefined);
      return undefined;
    }

    const fieldEnum = schemaBuilder.enumType(`${baseName}SearchFieldEnum`, {
      description: `A column of ${tableSchema.tsName} the search can look at`,
      values: columnKeys,
    });

    const ref = schemaBuilder.inputType(inputTypeName, {
      description: `Fuzzy search on ${tableSchema.tsName}, ranked by how close the columns are to the term`,
      fields: (t) => ({
        term: t.string({ required: true }),
        fields: t.field({
          type: [fieldEnum],
          required: false,
          description:
            "Limits the search to these columns. Without it every listed column is searched. Columns the caller may not read are left out, so an empty or fully hidden selection finds no rows.",
        }),
      }),
    });

    referenceStorage.set(inputTypeName, ref);
    return ref;
  };
};
