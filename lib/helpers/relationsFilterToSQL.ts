import {
  relationsFilterToSQL as collectRelationsFilter,
  is,
  SQL,
} from "drizzle-orm";

/**
 * A relational-API filter on `table` as one SQL condition, or `undefined` for a
 * filter that matches every row.
 *
 * Since drizzle 1.0.0-rc.5, `relationsFilterToSQL` collects the condition's
 * chunks instead of returning an `SQL`; this wraps them back into one. drizzle
 * already parenthesizes the condition, so it composes inside `or`, `case when`
 * and the like as it is.
 *
 * Builds before that (the rc.5 snapshots among them, which semver ranks above
 * rc.5, so the peer range cannot exclude them) return the `SQL` itself. Taking
 * that for an empty filter would drop every ability's where, so it is passed on.
 */
export function relationsFilterToSQL(
  table: Parameters<typeof collectRelationsFilter>[0],
  filter: Parameters<typeof collectRelationsFilter>[1],
  tableRelations: Parameters<typeof collectRelationsFilter>[2],
  tablesRelations: Parameters<typeof collectRelationsFilter>[3],
): SQL | undefined {
  const built: ReturnType<typeof collectRelationsFilter> | SQL | undefined =
    collectRelationsFilter(
      table,
      filter,
      tableRelations,
      tablesRelations,
      undefined,
    );
  if (built === undefined || is(built, SQL)) return built;
  return built.sql ? new SQL(built.sql) : undefined;
}
