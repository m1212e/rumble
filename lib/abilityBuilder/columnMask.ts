import { aliasedTable, or, relationsFilterToSQL, sql } from "drizzle-orm";
import { realWhere } from "../helpers/mergeFilters";
import { sanitizeFilterValue } from "../helpers/sanitizeFilterValue";
import type {
  DrizzleInstance,
  DrizzleQueryFunctionInput,
  TableRelationNames,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";
import {
  COLUMN_FLAG_KEY,
  COLUMN_REQUEST_KEY,
  columnMaskKey,
  resolvedFilterKey,
} from "./keys";
import { type RequestState, requestStateOf } from "./requestState";
import type { AbilitySettings, TableSchema } from "./types";

type HiddenColumns = {
  /** cleared on the row */
  cleared: string[];
  /** primary keys stay on the row, their fields hide them */
  primaryKey: boolean;
};

export type ColumnMask = {
  guaranteed: Set<string>;
  conditional: Set<string>[];
  hiddenPerBits: Map<number, HiddenColumns>;
};

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

function selectedColumns(
  columns: Record<string, boolean | undefined> | undefined,
  allColumns: string[],
) {
  if (!columns) return new Set(allColumns);
  const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (entries.some(([, v]) => v)) {
    return new Set(entries.filter(([, v]) => v).map(([k]) => k));
  }
  if (entries.length === 0) return new Set<string>();
  return new Set(allColumns.filter((c) => columns[c] !== false));
}

function hiddenColumns(
  mask: ColumnMask,
  bits: number,
  allColumns: string[],
  primaryKey: string[],
) {
  let hidden = mask.hiddenPerBits.get(bits);
  if (!hidden) {
    const columns = allColumns.filter(
      (column) =>
        !mask.guaranteed.has(column) &&
        !mask.conditional.some(
          (columns, bit) => bits & (1 << bit) && columns.has(column),
        ),
    );
    hidden = {
      cleared: columns.filter((c) => !primaryKey.includes(c)),
      primaryKey: columns.some((c) => primaryKey.includes(c)),
    };
    mask.hiddenPerBits.set(bits, hidden);
  }
  return hidden;
}

const hasWhere = (where: unknown) =>
  !!where && Object.keys(where as object).length > 0;

type ColumnRule = { where: unknown; columns: Set<string> };

/** Columns every returned row is allowed to expose. */
function guaranteedColumns(rules: ColumnRule[], allColumnNames: string[]) {
  // every returned row matches at least one ability
  const guaranteed = new Set<string>();
  for (const rule of rules) {
    if (hasWhere(rule.where)) continue;
    for (const column of rule.columns) guaranteed.add(column);
  }
  for (const column of allColumnNames) {
    if (rules.every((r) => r.columns.has(column))) {
      guaranteed.add(column);
    }
  }
  return guaranteed;
}

/**
 * Groups the conditional rules by the columns they grant on top of the
 * guaranteed ones. Each group becomes one bit of the column flag.
 */
function conditionalGroups(rules: ColumnRule[], guaranteed: Set<string>) {
  const groups = new Map<string, { columns: Set<string>; wheres: unknown[] }>();
  for (const rule of rules) {
    if (!hasWhere(rule.where)) continue;
    const additional = [...rule.columns]
      .filter((c) => !guaranteed.has(c))
      .sort();
    if (additional.length === 0) continue;
    const key = additional.join(",");
    const group = groups.get(key);
    if (group) {
      group.wheres.push(rule.where);
    } else {
      groups.set(key, {
        columns: new Set(additional),
        wheres: [rule.where],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Creates the resolver which turns the abilities of a table into the columns
 * to select and, if columns depend on the matched ability, an extra computing
 * a per row flag plus the mask to decode it.
 */
export function createColumnAccessResolver<
  DB extends DrizzleInstance,
  Action extends string,
  TableName extends TableRelationNames<DB>,
>(
  { db, actions }: AbilitySettings<DB, Action>,
  tableName: TableName,
  tableSchema: TableSchema,
) {
  const allColumnNames = Object.keys(tableSchema.columns);
  const primaryKeyNames = Object.keys(tableSchema.primaryKey);
  const primaryKeyName = primaryKeyNames[0]!;
  const actionCount = actions.length;
  // the flag has to fit a signed 32 bit integer in every dialect
  const maxGroups = Math.floor(Math.log2(2 ** 31 / actionCount));

  const toSQL = (table: any, wheres: unknown[]) =>
    or(
      ...wheres.map((where) =>
        relationsFilterToSQL(
          table,
          sanitizeFilterValue(where) as any,
          tableSchema.relations,
          db._.relations,
        ),
      ),
    );

  // Relational filters become correlated subqueries, which would
  // run once per row. Uncorrelated, the database runs it once.
  const uncorrelated = (table: any, wheres: unknown[], bit: number) => {
    const inner = aliasedTable(tableSchema.table, `rumble_columns_${bit}`);
    return sql`${table[primaryKeyName]} in (${(db as any)
      .select({ pk: inner[primaryKeyName] })
      .from(inner)
      .where(toSQL(inner, wheres))})`;
  };

  // An ability's columns only apply to the rows matched by its where. The
  // wheres are expected to restrict rows, see `restrictingWhere`.
  return function resolveColumnAccess(
    action: Action,
    filters: DrizzleQueryFunctionInput<DB, TableName>[],
    requestId: number,
  ) {
    const rules = filters.map((f) => ({
      where: realWhere(f?.where),
      columns: selectedColumns(f?.columns as any, allColumnNames),
    }));

    const guaranteed = guaranteedColumns(rules, allColumnNames);
    const groups = conditionalGroups(rules, guaranteed);

    // primary keys are always loaded, pothos reloads rows and subscriptions
    // by them. If not granted, the mask hides them from the client.
    const selected = new Set([
      ...primaryKeyNames,
      ...rules.flatMap((r) => [...r.columns]),
    ]);
    const columns =
      selected.size === allColumnNames.length
        ? undefined
        : Object.fromEntries([...selected].map((c) => [c, true]));

    // A mask (and flag) is needed even without conditional groups: rows
    // loaded without the ability's columns (pothos reloads, custom resolvers)
    // are reduced to the guaranteed columns, and the flag records the action
    // the row was loaded with, so that action's mask applies.
    if (guaranteed.size === allColumnNames.length) {
      return { columns, extras: undefined, mask: undefined };
    }

    if (groups.length > maxGroups) {
      throw new RumbleError(
        `Too many abilities with differing columns on ${String(tableName)}/${action}: ${groups.length}, at most ${maxGroups} are supported.`,
      );
    }

    const mask: ColumnMask = {
      guaranteed,
      conditional: groups.map((g) => g.columns),
      hiddenPerBits: new Map(),
    };
    const groupWheres = groups.map((g) => ({
      wheres: g.wheres,
      relational: g.wheres.some((w) =>
        referencesRelation(w, tableSchema.relations),
      ),
    }));
    const actionIndex = actions.indexOf(action);
    const extras: Record<string, (table: any) => any> = {
      // a callback, so nested relation queries pass their aliased table
      [COLUMN_FLAG_KEY]: (table: any) => {
        const bits = groupWheres.map(({ wheres, relational }, bit) => {
          const condition = relational
            ? uncorrelated(table, wheres, bit)
            : toSQL(table, wheres);
          return sql`case when ${condition} then ${sql.raw(String(2 ** bit))} else 0 end`;
        });
        return bits.length
          ? sql`(${sql.raw(String(actionIndex))} + ${sql.raw(String(actionCount))} * (${sql.join(bits, sql` + `)}))`
          : sql`${sql.raw(String(actionIndex))}`;
      },
      [COLUMN_REQUEST_KEY]: () => sql`${sql.raw(String(requestId))}`,
    };

    return { columns, extras, mask };
  };
}

type Row = Record<PropertyKey, unknown>;

const isRow = (row: unknown): row is Row => !!row && typeof row === "object";

function clearColumns(row: Row, columns: string[]) {
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]!;
    if (row[column] !== undefined) row[column] = undefined;
  }
}

function maskRow(row: Row, hidden: HiddenColumns) {
  // assign instead of delete to keep the row's hidden class
  if (row[COLUMN_FLAG_KEY] != null) {
    row[COLUMN_FLAG_KEY] = undefined;
    row[COLUMN_REQUEST_KEY] = undefined;
  }
  clearColumns(row, hidden.cleared);
}

export type MaskColumnsInput<
  DB extends DrizzleInstance,
  Action extends string,
> = {
  table: TableRelationNames<DB>;
  action: Action;
  abilities: Record<string, any>;
  entities: unknown[];
};

/**
 * Creates the function hiding the columns of queried rows which the ability
 * that matched the row does not grant.
 */
export function createColumnMasker<
  DB extends DrizzleInstance,
  Action extends string,
>(
  { actions }: AbilitySettings<DB, Action>,
  tables: Map<
    TableRelationNames<DB>,
    { columns: string[]; primaryKey: string[] }
  >,
) {
  const actionCount = actions.length;

  const stateOf = (abilities: object) =>
    requestStateOf<Action>(abilities) as RequestState<Action>;

  const maskedActions = (
    abilities: object,
    table: TableRelationNames<DB>,
  ): Set<Action> => {
    const { actions } = stateOf(abilities);
    let used = actions.get(table);
    if (!used) {
      used = new Set();
      actions.set(table, used);
    }
    return used;
  };

  const primaryKeyHidden = (abilities: object, row: object) =>
    stateOf(abilities).masked.get(row) === true;

  const maskColumns = (
    { table, action, abilities, entities }: MaskColumnsInput<DB, Action>,
    start = 0,
  ): void | Promise<void> => {
    const tableAbilities = abilities[table];
    const { columns: columnNames, primaryKey } = tables.get(table)!;
    const state = stateOf(abilities);
    const used = maskedActions(abilities, table);

    for (let i = start; i < entities.length; i++) {
      const row = entities[i];
      if (!isRow(row) || state.masked.has(row)) continue;

      // a flag computed for another request doesn't apply to this one
      const code =
        Number(row[COLUMN_REQUEST_KEY]) === state.id
          ? row[COLUMN_FLAG_KEY]
          : undefined;
      const flagged = code != null;
      const encoded = flagged ? Number(code) : 0;
      const rowAction = flagged ? actions[encoded % actionCount]! : action;
      used.add(rowAction);

      const resolved = tableAbilities[resolvedFilterKey](rowAction);
      if (!resolved) {
        return tableAbilities
          .filter(rowAction)
          .then(() => maskColumns({ table, action, abilities, entities }, i));
      }

      const mask: ColumnMask | undefined = resolved[columnMaskKey];
      if (!mask) continue;

      const bits = Math.floor(encoded / actionCount);
      const hidden = hiddenColumns(mask, bits, columnNames, primaryKey);
      maskRow(row, hidden);
      state.masked.set(row, hidden.primaryKey);
    }
  };

  return { maskColumns, maskedActions, primaryKeyHidden };
}
