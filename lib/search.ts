import { sql } from "drizzle-orm";
import { cloneDeep } from "es-toolkit";
import { isPostgresDB } from "./helpers/determineDialectFromSchema";
import {
  isIDLikeSQLTypeString,
  isStringLikeSQLTypeString,
} from "./helpers/sqlTypes/types";
import type { tableHelper } from "./helpers/tableHelpers";
import type { RumbleInput } from "./types/rumbleInput";

export async function initSearchIfApplicable(
  input: RumbleInput<any, any, any, any, any>,
) {
  if (!isPostgresDB(input.db)) {
    console.info(
      "Database dialect is not compatible with search, skipping search initialization. Only PostgreSQL is supported.",
    );
    return;
  }

  await input.db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  if (input.search?.threshold) {
    // make absolutely sure the threshold is a number
    const threshold = Number(input.search.threshold);

    if (threshold < 0 || threshold > 1) {
      throw new Error(`Search threshold must be between 0 and 1`);
    }

    const result = await input.db.execute(sql`SELECT current_database()`);
    const dbName = result.rows[0].current_database;

    await input.db.execute(
      sql.raw(
        `ALTER DATABASE ${dbName} SET pg_trgm.similarity_threshold = ${threshold};`,
      ),
    );
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
  args,
  tableSchema,
  abilities,
}: Pick<RumbleInput<any, any, any, any, any>, "search"> & {
  //TODO types
  args: any;
  tableSchema: ReturnType<typeof tableHelper>;
  //TODO types
  abilities: any;
}) {
  if (search?.enabled && args.search && args.search.length > 0) {
    // this prevents columns beeing searched which are not accessible to the user
    // if the abilities defined the user not to be allowed to read something, we need
    // to prevent it from beeing included in the search since this could
    // leak information
    const columnsToSearch = (
      abilities.query.many.columns
        ? Object.entries(tableSchema.columns).filter(
            ([key]) => abilities.query.many.columns[key],
          )
        : Object.entries(tableSchema.columns)
    ).filter(
      ([key, col]) =>
        isStringLikeSQLTypeString(col.getSQLType()) ||
        isIDLikeSQLTypeString(col.getSQLType()),
    );

    const searchParam = sql`${args.search}`;

    args.extras = {
      search_distance: (table: any) =>
        sql`${sql.join(
          columnsToSearch.map(([key]) => {
            return sql`COALESCE((${table[key]}::TEXT <-> ${searchParam}), 1)`;
          }),
          sql.raw(" + "),
        )}`,
    };

    const originalOrderBy = cloneDeep(args.orderBy);
    (args as any).orderBy = (table: any) => {
      const argsOrderBySQL = sql.join(
        Object.entries(originalOrderBy ?? {}).map(([key, value]) => {
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

      const searchSQL = sql`search_distance ASC`;

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
              columnsToSearch.map(([key]) => {
                return sql`${table[key]} % ${searchParam}`;
              }),
              sql.raw(" OR "),
            )})`,
        },
      ],
    };
  }
}
