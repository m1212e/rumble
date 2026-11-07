import { sql } from "drizzle-orm";
import { unionAll as mysqlUnionAll } from "drizzle-orm/mysql-core";
import { unionAll as pgUnionAll } from "drizzle-orm/pg-core";
import { unionAll as sqliteUnionAll } from "drizzle-orm/sqlite-core";
import { determineDBDialectFromSchema } from "../helpers/determineDialectFromSchema";
import { realWhere } from "../helpers/mergeFilters";
import { relationsFilterToSQL } from "../helpers/relationsFilterToSQL";
import { sanitizeFilterValue } from "../helpers/sanitizeFilterValue";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import type { AbilitySettings, TableSchema } from "./types";

/**
 * Settings for resolving relational rules to primary key lists, see
 * `resolveRelationalRules` on the rumble input.
 */
export type RuleResolutionConfig = {
  /**
   * Whether relational rules are resolved to primary key lists before the
   * query.
   * @default false
   */
  enabled?: boolean;
  /**
   * A rule matching more rows than this stays relational.
   * @default 500
   */
  maxIds?: number;
};

const DEFAULT_MAX_RESOLVED_IDS = 500;

/**
 * Whether the where names a relation of the table, so it renders as (nested)
 * `exists` subqueries.
 */
function referencesRelation(
  filter: unknown,
  relations: Record<string, unknown>,
): boolean {
  if (!filter || typeof filter !== "object") return false;
  return Object.entries(filter).some(([key, value]) => {
    if (key === "AND" || key === "OR") {
      return (value as unknown[]).some((v) => referencesRelation(v, relations));
    }
    if (key === "NOT") return referencesRelation(value, relations);
    return key in relations;
  });
}

/**
 * Creates the function replacing the relational rules of a table by the
 * primary keys they match, resolved with one query per call.
 *
 * A relational rule ("the users whose delegation the caller supervises")
 * renders as a chain of correlated `exists` subqueries, once in the row filter
 * and once more in every column flag, at every place the table is nested in a
 * query. Planning such a statement costs the database tens of megabytes. For a
 * given caller the rule matches a fixed set of rows though, so this looks them
 * up once (`select pk from table where <rule>`) and the rule becomes
 * `pk in (...)`, which costs the planner nothing. Rules matching more than
 * `maxIds` rows stay relational, so broad rules do not turn into huge lists.
 *
 * Returns undefined when disabled or the table has no single primary key.
 */
export function createRuleResolver<
  DB extends DrizzleInstance,
  Action extends string,
>(settings: AbilitySettings<DB, Action>, tableSchema: TableSchema) {
  const config = settings.resolveRelationalRules;
  const primaryKeys = Object.keys(tableSchema.primaryKey);
  if (!config?.enabled || primaryKeys.length !== 1) return undefined;

  const maxIds = config.maxIds ?? DEFAULT_MAX_RESOLVED_IDS;
  const primaryKeyName = primaryKeys[0]!;
  const db = settings.db as any;
  const table = tableSchema.table as any;
  const dialect = determineDBDialectFromSchema(db._.relations);
  const unionAll = {
    postgres: pgUnionAll,
    sqlite: sqliteUnionAll,
    mysql: mysqlUnionAll,
  }[dialect] as (...queries: any[]) => any;

  // Postgres takes the list as one array parameter (`pk = any($1)`), so the
  // statement does not grow with it. The other dialects get `pk in (...)`,
  // one parameter per id.
  const listFilter = (ids: unknown[]) =>
    dialect === "postgres"
      ? {
          RAW: (aliased: any) =>
            sql`${aliased[primaryKeyName]} = any(${sql.param(ids)})`,
        }
      : { [primaryKeyName]: { in: ids } };

  /** The primary keys matching the rule, tagged with the rule's index. */
  const matches = (where: unknown, rule: number) => {
    const limited = db
      .select({
        pk: table[primaryKeyName],
        rule: sql.raw(String(rule)).as("rule"),
      })
      .from(table)
      .where(
        relationsFilterToSQL(
          table,
          sanitizeFilterValue(where) as any,
          tableSchema.relations,
          db._.relations,
        ),
      )
      .limit(maxIds + 1)
      .as(`rumble_rule_${rule}`);
    // wrapped, since SQLite allows no limit on the operands of a union
    return db.select({ pk: limited.pk, rule: limited.rule }).from(limited);
  };

  const whereOf = (filter: unknown) =>
    realWhere((filter as { where?: unknown } | undefined)?.where);

  return async function resolveRules<F>(
    filters: F[],
  ): Promise<{ filters: F[]; resolved: number }> {
    const relational = filters.flatMap((filter, index) =>
      referencesRelation(whereOf(filter), tableSchema.relations) ? [index] : [],
    );
    if (relational.length === 0) return { filters, resolved: 0 };

    const queries = relational.map((index) =>
      matches(whereOf(filters[index]), index),
    );
    const rows: { pk: unknown; rule: unknown }[] = await (queries.length === 1
      ? queries[0]
      : unionAll(...queries));

    const idsPerRule = new Map<number, unknown[]>(
      relational.map((index) => [index, []]),
    );
    for (const row of rows) idsPerRule.get(Number(row.rule))!.push(row.pk);

    let resolved = 0;
    const result: F[] = [];
    filters.forEach((filter, index) => {
      const ids = idsPerRule.get(index);
      if (!ids || ids.length > maxIds) {
        result.push(filter);
        return;
      }
      resolved++;
      // a rule matching no row grants nothing
      if (ids.length === 0) return;
      result.push({ ...(filter as object), where: listFilter(ids) } as F);
    });
    return { filters: result, resolved };
  };
}
