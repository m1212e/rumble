import { asc, desc, sql } from "drizzle-orm";
import { cloneDeep } from "es-toolkit";
import { type ColumnMask, columnMaskKey } from "./abilityBuilder";
import type { SearchArg } from "./args/searchArg";
import { isPostgresDB } from "./helpers/determineDialectFromSchema";
import { errorLogField } from "./helpers/errorLogging";
import {
  isIDLikeSQLTypeString,
  isStringLikeSQLTypeString,
} from "./helpers/sqlTypes/types";
import type { tableHelper } from "./helpers/tableHelpers";
import { RumbleError } from "./types/rumbleError";
import type { RumbleInput } from "./types/rumbleInput";

/**
 * Which columns of a table search looks at, as `object({ search })` sets it:
 * `false` switches search off for the table, a column list limits it to those
 * columns. Without a setting every text and id column is searched.
 */
export type ObjectSearchConfig<ColumnName extends string = string> =
  | false
  | { columns: readonly ColumnName[] };

type TableSchema = ReturnType<typeof tableHelper>;

const isSearchableColumn = (col: any) =>
  isStringLikeSQLTypeString(col.getSQLType()) ||
  isIDLikeSQLTypeString(col.getSQLType());

/**
 * The search settings of every table, by its ts name. Filled when the tables'
 * objects are created and read while the schema is built and requests resolve,
 * so a table's settings apply wherever it is searched: its list query and every
 * relation field leading to it.
 */
export function createSearchColumnRegistry() {
  const configs = new Map<string, ObjectSearchConfig>();

  return {
    register({
      tableSchema,
      config,
    }: {
      tableSchema: TableSchema;
      config: ObjectSearchConfig;
    }) {
      const table = tableSchema.tsName;
      if (config !== false) {
        if (config.columns.length === 0) {
          throw new RumbleError(
            `Search on "${table}" names no columns. Use \`search: false\` to switch it off.`,
          );
        }
        for (const key of config.columns) {
          const column = tableSchema.columns[key];
          if (!column) {
            throw new RumbleError(
              `Search on "${table}" names the column "${key}", which the table does not have.`,
            );
          }
          if (!isSearchableColumn(column)) {
            throw new RumbleError(
              `Search on "${table}" names the column "${key}", which is neither a text nor an id column.`,
            );
          }
        }
      }

      const existing = configs.get(table);
      if (existing !== undefined && !sameConfig(existing, config)) {
        throw new RumbleError(
          `The table "${table}" has objects with different search settings. Give every object of a table the same \`search\`.`,
        );
      }
      configs.set(table, config);
    },
    /** `false` when search is switched off for the table */
    isEnabled(table: string) {
      return configs.get(table) !== false;
    },
    configOf(table: string) {
      return configs.get(table);
    },
  };
}

export type SearchColumnRegistry = ReturnType<
  typeof createSearchColumnRegistry
>;

function sameConfig(a: ObjectSearchConfig, b: ObjectSearchConfig) {
  if (a === false || b === false) return a === b;
  return (
    a.columns.length === b.columns.length &&
    a.columns.every((column) => b.columns.includes(column))
  );
}

/**
 * The columns the server searches a table by: the ones its object names, or
 * every text and id column. These are the values a client can pick from.
 */
export function serverSearchColumnKeys({
  tableSchema,
  searchColumns,
}: {
  tableSchema: TableSchema;
  searchColumns: SearchColumnRegistry;
}) {
  const config = searchColumns.configOf(tableSchema.tsName);
  return config
    ? [...config.columns]
    : Object.entries(tableSchema.columns)
        .filter(([, col]) => isSearchableColumn(col))
        .map(([key]) => key);
}

/**
 * The columns a search looks at: the server's selection, narrowed to what the
 * client asked for, of which only those the caller may read on every row.
 * A column only some rows expose would otherwise tell by whether a row matches
 * what it holds.
 */
function columnsToSearch({
  tableSchema,
  abilities,
  searchColumns,
  requested,
}: {
  tableSchema: TableSchema;
  abilities: any;
  searchColumns: SearchColumnRegistry;
  /** the columns the client asked for; the server's selection without */
  requested?: readonly string[] | null;
}) {
  const serverSelected = serverSearchColumnKeys({ tableSchema, searchColumns });
  // the enum already keeps the client inside the server's selection
  const candidates = requested
    ? serverSelected.filter((key) => requested.includes(key))
    : serverSelected;
  const columnMask: ColumnMask | undefined = abilities[columnMaskKey];
  // without a mask every column is guaranteed
  return columnMask
    ? candidates.filter((key) => columnMask.guaranteed.has(key))
    : candidates;
}

export async function initSearchIfApplicable(
  input: RumbleInput<any, any, any, any, any, any>,
) {
  const log = input.logger?.enabled ? input.logger.logger : undefined;

  if (!isPostgresDB(input.db)) {
    const msg =
      "Database dialect is not compatible with search, skipping search initialization. Only PostgreSQL is supported.";
    log ? log.info({}, msg) : console.info(msg);
    return;
  }

  try {
    await input.db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  } catch (error) {
    const msg =
      "Failed to create pg_trgm extension. Search functionality may not work. Ensure the database user has CREATE privilege or the extension is pre-installed.";
    log ? log.error(errorLogField(error), msg) : console.error(msg, error);
    return;
  }
  if (input.search?.threshold) {
    // make absolutely sure the threshold is a number
    const threshold = Number(input.search.threshold);

    if (threshold < 0 || threshold > 1) {
      throw new Error(`Search threshold must be between 0 and 1`);
    }

    const result = await input.db.execute(sql`SELECT current_database()`);
    const dbName = result.rows[0].current_database;

    try {
      await input.db.execute(
        sql.raw(
          `ALTER DATABASE ${dbName} SET pg_trgm.similarity_threshold = ${threshold};`,
        ),
      );
    } catch (error: any) {
      // XX000 = tuple concurrently updated: multiple workers racing to set the same
      // idempotent value at startup. Safe to ignore — one of them will win.
      if (error?.cause?.code !== "XX000" && error?.code !== "XX000")
        throw error;
    }
  }

  if (input.search?.cpu_operator_cost) {
    if (typeof input.search.cpu_operator_cost !== "number") {
      throw new Error(`CPU operator cost must be a number`);
    }

    if (input.search.cpu_operator_cost <= 0) {
      throw new Error(`CPU operator cost must be a positive number`);
    }
  }
}

/**
 * Performs adjustments to the query args to issue a full text search in case the
 * respective feature is enabled and a search term was provided.
 */
export function adjustQueryArgsForSearch({
  search,
  searchColumns,
  args,
  tableSchema,
  abilities,
}: Pick<RumbleInput<any, any, any, any, any, any>, "search"> & {
  searchColumns: SearchColumnRegistry;
  //TODO types
  args: any;
  tableSchema: TableSchema;
  //TODO types
  abilities: any;
}) {
  if (!searchColumns.isEnabled(tableSchema.tsName)) {
    delete args.search;
    return;
  }
  if (args.search === undefined || args.search === null) return;

  // from here on `args.search` is just the term
  const { term, fields: requested } = args.search as SearchArg;
  args.search = term;

  if (search?.enabled && term.length > 0) {
    const columns = columnsToSearch({
      tableSchema,
      abilities,
      searchColumns,
      requested,
    });

    // nothing the caller may search: no row matches, rather than every one
    if (columns.length === 0) {
      delete args.search;
      args.where = {
        AND: [cloneDeep(args.where) ?? {}, { RAW: () => sql`false` }],
      };
      return;
    }

    const searchParam = sql`${args.search}`;

    const searchDistance = (table: any) =>
      sql`(${sql.join(
        columns.map((key) => {
          return sql`COALESCE((${table[key]}::TEXT <-> ${searchParam}), 1)`;
        }),
        sql.raw(" + "),
      )})`;

    args.extras = { search_distance: searchDistance };

    const originalOrderBy =
      typeof args.orderBy === "function"
        ? args.orderBy
        : cloneDeep(args.orderBy);
    (args as any).orderBy = (table: any) => {
      // a function when the order was restricted to what the caller may read
      const argsOrderBySQL = sql.join(
        typeof originalOrderBy === "function"
          ? originalOrderBy(table, { asc, desc })
          : Object.entries(originalOrderBy ?? {}).map(([key, value]) => {
              // value is "asc" or "desc"
              if (value === "asc") {
                return sql`${table[key]} ASC`;
              } else if (value === "desc") {
                return sql`${table[key]} DESC`;
              } else {
                throw new Error(`Invalid value ${value} for orderBy`);
              }
            }),
        sql.raw(", "),
      );

      // the expression, not the `search_distance` alias: with relations in the
      // selection drizzle orders and limits in a subquery that only selects the
      // table's columns, where the alias does not exist
      const searchSQL = sql`${searchDistance(table)} ASC`;

      const ret = originalOrderBy
        ? sql.join([argsOrderBySQL, searchSQL], sql.raw(", "))
        : searchSQL;

      return ret;
    };

    const originalWhere = cloneDeep(args.where);

    // this limits the search to the rows which at least match the threshold score
    (args as any).where = {
      AND: [
        originalWhere ?? {},
        {
          RAW: (table: any) =>
            sql`(${sql.join(
              columns.map((key) => {
                return sql`${table[key]} % ${searchParam}`;
              }),
              sql.raw(" OR "),
            )})`,
        },
      ],
    };
  }
}
