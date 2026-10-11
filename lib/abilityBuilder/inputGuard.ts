import { relationsFilterToSQL, sql } from "drizzle-orm";
import { sanitizeFilterValue } from "../helpers/sanitizeFilterValue";
import { tableHelper } from "../helpers/tableHelpers";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import type { ColumnVisibility } from "./columnMask";
import { columnVisibilityKey, guardInputKey } from "./keys";
import { createBlockEverythingFilter } from "./tableAbilities";

type Where = Record<string, any>;

/** The ts names of the columns a relation joins on, on either side. */
export function relationColumnKeys(
  db: DrizzleInstance,
  table: string,
  columns: unknown[] | undefined,
) {
  const known = tableHelper({ db, table }).columns;
  return (columns ?? []).flatMap((column: any) => {
    const raw = column?._?.column ?? column;
    const key = Object.entries(known).find(
      ([name, candidate]) => candidate === raw || name === raw?.name,
    )?.[0];
    return key ? [key] : [];
  });
}

export type GuardedInput = { where?: unknown; orderBy?: unknown };

type InputGuard = ReturnType<typeof createInputGuard>;

const isObject = (value: unknown): value is Where =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Column masking hides values after the query ran, but a `where` or `orderBy`
 * argument is applied by the database on the real values: filtering for
 * `{ salary: { gt: 5000 } }` reveals which rows exceed it whether or not the
 * column may be read. This restricts such arguments to what the abilities
 * expose:
 *
 * - a column only matches on rows which expose it, for all other rows the
 *   condition is false
 * - sorting by a column treats it as empty on rows which do not expose it
 * - a relation filter requires the columns the relation joins on to be
 *   exposed, and is restricted to the rows the caller may read of the related
 *   table, whose masked columns follow the same rules
 */
export function createInputGuard<DB extends DrizzleInstance>({
  db,
  abilities,
  readActionOf,
}: {
  db: DB;
  abilities: Record<string, any>;
  readActionOf: (table: string) => string;
}) {
  const visibilityOf = async (table: string, action: string) =>
    (await abilities[table].filter(action))[columnVisibilityKey] as
      | ColumnVisibility
      | undefined;

  const never = (table: string) =>
    createBlockEverythingFilter(table, tableHelper({ db, table })).where;

  /** The conditions under which the given columns are exposed. */
  const exposed = async (table: string, action: string, keys: string[]) => {
    const visibility = await visibilityOf(table, action);
    if (!visibility) return [];
    const conditions: unknown[] = [];
    for (const key of keys) {
      const condition = visibility(key);
      if (condition === true) continue;
      conditions.push(condition === false ? never(table) : condition);
    }
    return conditions;
  };

  /** The filter of a relation: the related rows the caller may read, exposing what it joins on. */
  const guardRelation = async (
    table: string,
    action: string,
    key: string,
    value: unknown,
    guarded: Where,
    conditions: unknown[],
  ) => {
    const relation = tableHelper({ db, table }).relations[key] as any;
    const target = relation.targetTableName as string;
    const targetAction = readActionOf(target);
    const targetKeys = relationColumnKeys(db, target, relation.targetColumns);

    conditions.push(
      ...(await exposed(
        table,
        action,
        relationColumnKeys(db, table, relation.sourceColumns),
      )),
    );

    const readable = (await abilities[target].filter(targetAction)).query.many
      .where;
    const related = [
      ...(readable ? [readable] : []),
      ...(await exposed(target, targetAction, targetKeys)),
    ];
    const inner = isObject(value)
      ? ((await guardWhere(target, targetAction, value)) as Where)
      : {};

    if (related.length === 0) {
      guarded[key] = isObject(value) ? inner : value;
    } else if (value === false) {
      // "has no related rows" means none of the ones the caller can see
      conditions.push({ NOT: { [key]: { AND: related } } });
    } else {
      guarded[key] = { ...inner, AND: [...(inner.AND ?? []), ...related] };
    }
  };

  // the operands of AND / OR (a list) and NOT (a single filter)
  const guardLogic = (table: string, action: string, value: unknown) =>
    Array.isArray(value)
      ? Promise.all(value.map((v) => guardWhere(table, action, v)))
      : guardWhere(table, action, value);

  /** A single entry of a where: a logical operator, a relation or a column. */
  const guardEntry = async (
    table: string,
    action: string,
    [key, value]: [string, unknown],
    guarded: Where,
    conditions: unknown[],
  ) => {
    const schema = tableHelper({ db, table });
    if (key === "AND" || key === "OR" || key === "NOT") {
      guarded[key] = await guardLogic(table, action, value);
    } else if (key in schema.relations) {
      await guardRelation(table, action, key, value, guarded, conditions);
    } else {
      guarded[key] = value;
      if (key in schema.columns) {
        conditions.push(...(await exposed(table, action, [key])));
      }
    }
  };

  const guardWhere = async (
    table: string,
    action: string,
    where: unknown,
  ): Promise<unknown> => {
    if (!isObject(where)) return where;
    const guarded: Where = {};
    const conditions: unknown[] = [];

    for (const entry of Object.entries(where)) {
      await guardEntry(table, action, entry, guarded, conditions);
    }

    if (conditions.length === 0) return guarded;
    return { ...guarded, AND: [...(guarded.AND ?? []), ...conditions] };
  };

  const guardOrderBy = async (
    table: string,
    action: string,
    orderBy: unknown,
  ): Promise<unknown> => {
    if (!isObject(orderBy)) return orderBy;
    const visibility = await visibilityOf(table, action);
    if (!visibility) return orderBy;
    const entries = Object.entries(orderBy).filter(
      ([, direction]) => direction,
    );
    if (entries.every(([key]) => visibility(key) === true)) return orderBy;

    const schema = tableHelper({ db, table });
    return (aliased: any, { asc, desc }: any) =>
      entries.map(([key, direction]) => {
        const condition = visibility(key);
        const column = aliased[key];
        const value =
          condition === true
            ? column
            : condition === false
              ? null
              : // the column only counts where it is exposed
                sql`case when ${relationsFilterToSQL(
                  aliased,
                  sanitizeFilterValue(condition) as any,
                  schema.relations,
                  db._.relations,
                )} then ${column} end`;
        return (direction === "asc" ? asc : desc)(value ?? sql`null`);
      });
  };

  return {
    input: async (table: string, action: string, input: GuardedInput) => ({
      ...input,
      where: await guardWhere(table, action, input.where),
      orderBy: await guardOrderBy(table, action, input.orderBy),
    }),
    exposed,
  };
}

/**
 * Restricts client supplied `where` and `orderBy` arguments to what the
 * abilities of the request let the caller read, see `createInputGuard`.
 */
export function guardFilterInput(
  abilities: object,
  table: string,
  action: string,
  input: GuardedInput,
) {
  const guard = (abilities as any)[guardInputKey] as InputGuard | undefined;
  return guard ? guard.input(table, action, input) : Promise.resolve(input);
}

/**
 * The conditions a row of the related table has to meet to be reached through
 * a relation: the columns the relation joins on have to be exposed on it.
 */
export async function relationExposure(
  abilities: object,
  table: string,
  action: string,
  columns: string[],
) {
  const guard = (abilities as any)[guardInputKey] as InputGuard | undefined;
  return guard ? guard.exposed(table, action, columns) : [];
}
