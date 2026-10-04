// Frozen copy of lib/abilityBuilder.ts from before the refactor into
// lib/abilities/. It only exists so abilityBuilderIdentity.test-d.ts can
// assert that the refactored public types are identical. Do not edit.
// The one deliberate deviation: the internal resolvedFilterKey is kept out of
// the filter type, since declaration emit cannot name it (broke the build).
import type { AttributeValue, Span } from "@opentelemetry/api";
import { aliasedTable, or, relationsFilterToSQL, sql } from "drizzle-orm";
import { debounce } from "es-toolkit";
import { errorLogField } from "../../../lib/helpers/errorLogging";
import { lazy } from "../../../lib/helpers/lazy";
import { mergeFilters, realWhere } from "../../../lib/helpers/mergeFilters";
import { sanitizeFilterValue } from "../../../lib/helpers/sanitizeFilterValue";
import { createDistinctValuesFromSQLType } from "../../../lib/helpers/sqlTypes/distinctValuesFromSQLType";
import { tableHelper } from "../../../lib/helpers/tableHelpers";
import {
  ATTR_ABILITIES_DYNAMIC,
  ATTR_ABILITIES_STATIC,
  ATTR_ABILITIES_STATUS,
  ATTR_ABILITIES_TOTAL,
  ATTR_ACTION,
  ATTR_TABLE,
  recordSpanError,
  SPAN_ABILITIES_PREPARE,
  type TelemetryConfig,
  traceCorrelationFields,
} from "../../../lib/helpers/telemetry";
import type {
  Filter,
  FilterPrefetchCombo,
  Prefetch,
} from "../../../lib/runtimeFiltersPlugin/filterTypes";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
  DrizzleQueryFunctionInput,
  DrizzleTableValueType,
  TableRelationNames,
} from "../../../lib/types/drizzleInstanceType";
import { RumbleError } from "../../../lib/types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
  RumbleLogger,
} from "../../../lib/types/rumbleInput";

//TODO: optimize this for v8 & refactor

export type LegacyAbilityBuilderType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
  typeof createAbilityBuilder<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >
>;

/**
 * Static, non changing query filter input type for a specific table
 */
type StaticQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
> = Filter;

/**
 * Dynamic, context based query filter input type for a specific table
 */
type DynamicQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
> = (
  context: Context,
) =>
  | StaticQueryFilter<DB, Table, Filter>
  | undefined
  | "allow"
  | Promise<StaticQueryFilter<DB, Table, Filter> | undefined | "allow">;

/**
 * Combined query filter type for a specific table. May be static or dynamic.
 */
type QueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
> =
  | StaticQueryFilter<DB, Table, Filter>
  | DynamicQueryFilter<DB, Table, Filter, Context>;

function isDynamicQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
>(
  filter: QueryFilter<DB, Table, Filter, Context>,
): filter is DynamicQueryFilter<DB, Table, Filter, Context> {
  return typeof filter === "function";
}

function isStaticQueryFilter<
  DB extends DrizzleInstance,
  Table extends keyof DrizzleQueryFunction<DB>,
  Filter extends DrizzleQueryFunctionInput<DB, Table>,
  Context,
>(
  filter: QueryFilter<DB, Table, Filter, Context>,
): filter is StaticQueryFilter<DB, Table, Filter> {
  return typeof filter !== "function";
}

/**
 * filter() is async. Without type checking (plain JS, `any`) a forgotten await would
 * hand the promise itself to drizzle
 */
function guardAgainstMissingAwait<T>(promise: Promise<T>): Promise<T> {
  for (const key of ["query", "sql", "merge"]) {
    Object.defineProperty(promise, key, {
      enumerable: true,
      get() {
        throw new RumbleError(
          `Tried to access "${key}" on the result of abilities.<table>.filter(...) which is a Promise. filter() is async, did you forget to await it?`,
        );
      },
    });
  }
  return promise;
}

// per row: actionIndex + actionCount * bits of the matched column groups
const COLUMN_FLAG_KEY = "__rumble_columns";

type ColumnMask = {
  guaranteed: Set<string>;
  conditional: Set<string>[];
  hiddenPerBits: Map<number, string[]>;
};

import {
  columnMaskKey,
  resolvedFilterKey,
} from "../../../lib/abilityBuilder/keys";

// A second pass in the same request would see the cleared flag and hide the
// conditionally granted columns. Rows reused by another request are masked again.
const maskedByKey = Symbol.for("rumble:maskedBy");

function referencesRelation(
  filter: unknown,
  relations: Record<string, unknown>,
): boolean {
  if (!filter || typeof filter !== "object") return false;
  for (const [key, value] of Object.entries(filter)) {
    if (key === "AND" || key === "OR") {
      if ((value as unknown[]).some((v) => referencesRelation(v, relations))) {
        return true;
      }
    } else if (key === "NOT") {
      if (referencesRelation(value, relations)) return true;
    } else if (key in relations) {
      return true;
    }
  }
  return false;
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

function hiddenColumns(mask: ColumnMask, bits: number, allColumns: string[]) {
  let hidden = mask.hiddenPerBits.get(bits);
  if (!hidden) {
    hidden = allColumns.filter(
      (column) =>
        !mask.guaranteed.has(column) &&
        !mask.conditional.some(
          (columns, bit) => bits & (1 << bit) && columns.has(column),
        ),
    );
    mask.hiddenPerBits.set(bits, hidden);
  }
  return hidden;
}

const makeNothingRegisteredWarner = (
  config: TelemetryConfig,
  logger?: RumbleLogger,
) =>
  debounce((model: string, action: string) => {
    const msg = `No abilities registered for ${model}/${action} — blocking everything. Register the ability or ignore this warning if intentional.`;
    if (logger) {
      logger.warn(
        {
          [ATTR_TABLE]: model,
          [ATTR_ACTION]: action,
          ...traceCorrelationFields(config),
        },
        msg,
      );
    } else {
      console.warn(msg);
    }
  }, 1000);

const createAbilityBuilder = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>({
  db,
  actions,
  defaultLimit,
  otel,
  logger: loggerConfig,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>) => {
  const log = loggerConfig?.enabled ? loggerConfig.logger : undefined;
  const telemetryConfig: TelemetryConfig = { otel, logger: loggerConfig };
  const nothingRegisteredWarningLogger = makeNothingRegisteredWarner(
    telemetryConfig,
    log,
  );
  type TableNames = TableRelationNames<DB>;

  // Views/materialized views can appear in db.query (if the caller's schema
  // includes them)
  const tableRelationNames = (
    Object.keys(db.query) as (keyof DrizzleQueryFunction<DB>)[]
  ).filter(
    (name) => tableHelper({ db, table: name as any }).isTable,
  ) as TableNames[];

  let hasBeenBuilt = false;

  const createBuilderForTable = <TableName extends TableNames>() => {
    const queryFilters = new Map<
      Action,
      | QueryFilter<
          DB,
          TableName,
          DrizzleQueryFunctionInput<DB, TableName>,
          UserContext
        >[]
      | "unrestricted"
    >();

    const runtimeFilters = new Map<
      Action,
      //TODO add a run all helper
      FilterPrefetchCombo<UserContext, any, any>[]
    >();

    // we want to init all possible runtime filters since we want to ensure
    // that the implementaiton helpers pass an object by reference when creating
    // the implementation, instead of a copy like it would be the case with undefined
    for (const action of actions!) {
      if (!runtimeFilters.has(action)) {
        runtimeFilters.set(action, []);
      }
    }

    return {
      /**
       * Allows to perform a specific action on a specific entity
       */
      allow: (action: Action | Action[]) => {
        if (hasBeenBuilt) {
          throw new RumbleError(
            "You can't call allow() after the ability builder has been built. Please ensure that you register all abilities before accessing them.",
          );
        }

        const actions = Array.isArray(action) ? action : [action];
        // Track which actions this specific allow() call initialized as "unrestricted",
        // so .when() can distinguish chained use (allow().when()) from a later separate call
        // that finds a pre-existing "unrestricted" from a prior bare allow().
        const setUnrestrictedByThisCall = new Set<(typeof actions)[number]>();
        for (const action of actions) {
          let filters = queryFilters.get(action);
          if (!filters) {
            filters = "unrestricted";
            queryFilters.set(action, filters);
            setUnrestrictedByThisCall.add(action);
          }
        }

        return {
          /**
           * Restricts the allowed actions to a filter
           * @example
           * ```ts
           * abilityBuilder.users.allow(["read", "update", "delete"]).when(({ userId }) => ({
           *    where: {
           *      id: userId,
           *    },
           *  }));
           * ```
           */
          when: (
            queryFilter: QueryFilter<
              DB,
              TableName,
              DrizzleQueryFunctionInput<DB, TableName>,
              UserContext
            >,
          ) => {
            for (const action of actions) {
              if (queryFilters.get(action) === "unrestricted") {
                if (setUnrestrictedByThisCall.has(action)) {
                  // Chained directly on this allow() call — override unrestricted with specific filter
                  queryFilters.set(action, []);
                } else {
                  // A previous separate bare allow() already set unrestricted
                  //  skip this filter
                  continue;
                }
              }
              const filters = queryFilters.get(action)!;
              (filters as Exclude<typeof filters, "unrestricted">).push(
                queryFilter,
              );
            }
          },
        };
      },
      /**
       * Allows to register an application level filter to restrict some results
       * which were returned by a query
       */
      filter: (action: Action | Action[]) => {
        const actions = Array.isArray(action) ? action : [action];
        return {
          /**
           * Allows to register an application level prefetch to fetch some data
           * which could be useful for later filtering the results. The prefetch
           * function will be called with the user context but unlike the actual
           * filter function, it will not have access to the result of the query
           * and therefore can be run in parallel with underlying query resolver.
           * A typical use case is to fetch some data which is not directly
           * related to the query but to the context only. So e.g. fetching the
           * user's permissions from an external system and then later applying
           * the filter based on those permissions.
           */
          prefetch: <PrefetchReturnType>(
            prefetch: Prefetch<UserContext, PrefetchReturnType>,
          ) => {
            return {
              /**
               * The actual filter function to apply. Returns the allowed values
               */
              by: (
                explicitFilter: Filter<
                  UserContext,
                  DrizzleTableValueType<DB, TableName>,
                  PrefetchReturnType
                >,
              ) => {
                for (const action of actions) {
                  // we initialized all possible actions when creating the builder
                  runtimeFilters.get(action)!.push({
                    filter: explicitFilter,
                    prefetch: prefetch,
                  });
                }
              },
            };
          },
          /**
           * The actual filter function to apply. Returns the allowed values
           */
          by: (
            explicitFilter: Filter<
              UserContext,
              DrizzleTableValueType<DB, TableName>
            >,
          ) => {
            for (const action of actions) {
              // we initialized all possible actions when creating the builder
              runtimeFilters.get(action)!.push({
                filter: explicitFilter as Filter<UserContext, any, any>,
              });
            }
          },
        };
      },
      _: {
        runtimeFilters,
        queryFilters,
      },
    };
  };

  const buildersPerTable = Object.fromEntries(
    tableRelationNames.map((tableName) => [
      tableName,
      createBuilderForTable<typeof tableName>(),
    ]),
  ) as {
    [key in TableNames]: ReturnType<typeof createBuilderForTable<key>>;
  };

  const columnNamesPerTable = new Map(
    tableRelationNames.map((tableName) => [
      tableName,
      Object.keys(tableHelper({ db, table: tableName }).columns),
    ]),
  );

  type MaskColumnsInput = {
    table: TableNames;
    action: Action;
    abilities: Record<string, any>;
    entities: unknown[];
  };

  const maskColumns = (
    { table, action, abilities, entities }: MaskColumnsInput,
    start = 0,
  ): void | Promise<void> => {
    const tableAbilities = abilities[table];
    const columnNames = columnNamesPerTable.get(table)!;
    const actionCount = actions!.length;

    for (let i = start; i < entities.length; i++) {
      const row = entities[i] as Record<PropertyKey, unknown> | null;
      if (!row || typeof row !== "object" || row[maskedByKey] === abilities) {
        continue;
      }

      const code = row[COLUMN_FLAG_KEY];
      const flagged = code !== undefined && code !== null;
      const encoded = flagged ? Number(code) : 0;
      const rowAction = flagged ? actions![encoded % actionCount]! : action;

      const resolved = tableAbilities[resolvedFilterKey](rowAction);
      if (!resolved) {
        return tableAbilities
          .filter(rowAction)
          .then(() => maskColumns({ table, action, abilities, entities }, i));
      }

      const mask: ColumnMask | undefined = resolved[columnMaskKey];
      if (!mask) continue;

      // assign instead of delete to keep the row's hidden class
      row[maskedByKey] = abilities;
      if (flagged) row[COLUMN_FLAG_KEY] = undefined;
      const hidden = hiddenColumns(
        mask,
        Math.floor(encoded / actionCount),
        columnNames,
      );
      for (let h = 0; h < hidden.length; h++) {
        const column = hidden[h]!;
        if (row[column] !== undefined) row[column] = undefined;
      }
    }
  };

  const readActionPerTable = new Map<TableNames, Action>();

  return {
    ...buildersPerTable,
    /**
     * @internal
     * @ignore
     */
    _: {
      maskColumns: (input: MaskColumnsInput) => maskColumns(input),
      registerReadAction(table: TableNames, action: Action) {
        readActionPerTable.set(table, action);
      },
      readActionOf(table: TableNames): Action {
        return readActionPerTable.get(table) ?? ("read" as Action);
      },
      registeredFilters({
        action,
        table,
      }: {
        table: TableNames;
        action: Action;
      }) {
        return (buildersPerTable[table] as any)._.runtimeFilters.get(
          action,
        )! as Filter<UserContext, DrizzleTableValueType<DB, TableNames>>[];
      },
      build() {
        const createFilterForTable = <TableName extends TableNames>(
          tableName: TableName,
        ) => {
          const queryFilters = buildersPerTable[tableName]._.queryFilters;

          const simpleQueryFilters = Object.fromEntries(
            actions!.map((action) => {
              const filters = queryFilters.get(action);

              if (!filters || filters === "unrestricted") return [action, []];

              return [action, filters.filter(isStaticQueryFilter)];
            }),
          ) as {
            [key in Action]: StaticQueryFilter<
              DB,
              TableName,
              DrizzleQueryFunctionInput<DB, TableName>
            >[];
          };

          const dynamicQueryFilters = Object.fromEntries(
            actions!.map((action) => {
              const filters = queryFilters.get(action);

              if (!filters || filters === "unrestricted") return [action, []];

              return [action, filters.filter(isDynamicQueryFilter)];
            }),
          ) as {
            [key in Action]: DynamicQueryFilter<
              DB,
              TableName,
              DrizzleQueryFunctionInput<DB, TableName>,
              UserContext
            >[];
          };

          const tableSchema = tableHelper({
            db,
            table: tableName,
          });

          if (Object.keys(tableSchema.primaryKey).length === 0) {
            throw new RumbleError(
              `No primary key found for entity ${String(tableName)}`,
            );
          }

          const primaryKeyField: any = Object.values(tableSchema.primaryKey)[0];
          const primaryKeyName = Object.keys(tableSchema.primaryKey)[0]!;
          // we want a filter that excludes everything
          const distinctValues = createDistinctValuesFromSQLType(
            primaryKeyField.getSQLType() as any,
          );

          const blockEverythingFilter = {
            where: {
              AND: [
                {
                  [primaryKeyField.name]: distinctValues.value1,
                },
                {
                  [primaryKeyField.name]: distinctValues.value2,
                },
              ],
            },
          };

          const allColumnNames = Object.keys(tableSchema.columns);

          // An ability's columns only apply to the rows matched by its where.
          function resolveColumnAccess(
            action: Action,
            filters: DrizzleQueryFunctionInput<DB, TableName>[],
          ) {
            const rules = filters.map((f) => ({
              where: realWhere(f?.where),
              columns: selectedColumns(f?.columns as any, allColumnNames),
            }));

            // every returned row matches at least one ability
            const guaranteed = new Set<string>();
            for (const rule of rules) {
              if (rule.where && Object.keys(rule.where).length > 0) continue;
              for (const column of rule.columns) guaranteed.add(column);
            }
            for (const column of allColumnNames) {
              if (rules.every((r) => r.columns.has(column))) {
                guaranteed.add(column);
              }
            }

            const groups = new Map<
              string,
              { columns: Set<string>; wheres: unknown[] }
            >();
            for (const rule of rules) {
              if (!rule.where || Object.keys(rule.where).length === 0) continue;
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

            const selected = new Set(rules.flatMap((r) => [...r.columns]));
            const columns =
              selected.size === allColumnNames.length
                ? undefined
                : Object.fromEntries([...selected].map((c) => [c, true]));

            if (guaranteed.size === allColumnNames.length) {
              return { columns, extras: undefined, mask: undefined };
            }

            const actionCount = actions!.length;
            // the flag has to fit a signed 32 bit integer in every dialect
            const maxGroups = Math.floor(Math.log2(2 ** 31 / actionCount));
            if (groups.size > maxGroups) {
              throw new RumbleError(
                `Too many abilities with differing columns on ${String(tableName)}/${action}: ${groups.size}, at most ${maxGroups} are supported.`,
              );
            }

            const mask: ColumnMask = {
              guaranteed,
              conditional: [...groups.values()].map((g) => g.columns),
              hiddenPerBits: new Map(),
            };
            const groupWheres = [...groups.values()].map((g) => ({
              wheres: g.wheres,
              relational: g.wheres.some((w) =>
                referencesRelation(w, tableSchema.relations),
              ),
            }));
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
            const actionIndex = actions!.indexOf(action);
            const extras: Record<string, (table: any) => any> = {
              // a callback, so nested relation queries pass their aliased table
              [COLUMN_FLAG_KEY]: (table: any) => {
                const bits = groupWheres.map(({ wheres, relational }, bit) => {
                  // Relational filters become correlated subqueries, which would
                  // run once per row. Uncorrelated, the database runs it once.
                  const condition = relational
                    ? (() => {
                        const inner = aliasedTable(
                          tableSchema.table,
                          `rumble_columns_${bit}`,
                        );
                        return sql`${table[primaryKeyName]} in (${(db as any)
                          .select({ pk: inner[primaryKeyName] })
                          .from(inner)
                          .where(toSQL(inner, wheres))})`;
                      })()
                    : toSQL(table, wheres);
                  return sql`case when ${condition} then ${sql.raw(String(2 ** bit))} else 0 end`;
                });
                return bits.length
                  ? sql`(${sql.raw(String(actionIndex))} + ${sql.raw(String(actionCount))} * (${sql.join(bits, sql` + `)}))`
                  : sql`${sql.raw(String(actionIndex))}`;
              },
            };

            return { columns, extras, mask };
          }

          /**
           * Packs the filters into a response object that can be applied for queries by the user
           */
          function transformToResponse(
            queryFilters?: DrizzleQueryFunctionInput<DB, TableName>,
            columnMask?: ColumnMask,
          ) {
            const internalTransformer = (
              filters?: DrizzleQueryFunctionInput<DB, TableName>,
              mergedLimit?: number,
            ) => {
              const limit = lazy(() => {
                if (
                  // got a merge injection
                  mergedLimit !== undefined
                ) {
                  if (!filters?.limit) {
                    // there is not ability limit
                    return mergedLimit;
                  }

                  if ((filters.limit as number) > mergedLimit) {
                    // there is an ability limit and it is higher that the injected merge limit
                    return mergedLimit;
                  }
                }

                let limit = filters?.limit as number | undefined;

                if (
                  defaultLimit &&
                  (limit === undefined || limit > defaultLimit)
                ) {
                  limit = defaultLimit;
                }

                // ensure that null is converted to undefined
                return limit ?? undefined;
              });

              const sqlTransformedWhere = lazy(() => {
                const casing = (db._ as any).session?.dialect?.casing;

                return filters?.where
                  ? relationsFilterToSQL(
                      tableSchema.foundRelation.table,
                      sanitizeFilterValue(filters.where) as any,
                      tableSchema.relations,
                      db._.relations,
                      casing,
                    )
                  : undefined;
              });

              // we acutally need to define multiple return objects since we do not want to use delete for
              // performance reasons and an undefined columns field on a drizzle filter will prevent any
              // column from being selected at all
              if (filters?.columns) {
                return {
                  /**
                   * Query filters for the drizzle query API.
                   * @example
                   * ```ts
                   * author: t.relation("author", {
                   *  query: async (_args, ctx) => (await ctx.abilities.users.filter("read")).query.single,
                   * }),
                   * ´´´
                   */
                  query: {
                    /**
                     * For find first calls
                     */
                    single: {
                      extras: filters?.extras,
                      where: sanitizeFilterValue(filters?.where),
                      columns: filters?.columns,
                    } as Pick<
                      NonNullable<
                        NonNullable<
                          Parameters<DB["query"][TableName]["findFirst"]>[0]
                        >
                      >,
                      "columns" | "where"
                    >,
                    /**
                     * For find many calls
                     */
                    many: {
                      extras: filters?.extras,
                      where: sanitizeFilterValue(filters?.where),
                      columns: filters?.columns,
                      get limit() {
                        return limit();
                      },
                    } as Pick<
                      NonNullable<
                        NonNullable<
                          Parameters<DB["query"][TableName]["findMany"]>[0]
                        >
                      >,
                      "columns" | "where" | "limit"
                    >,
                  },
                  /**
                   * Query filters for the drizzle SQL API as used in e.g. updates.
                   * @example
                   *
                   * ```ts
                   * await db
                   *	.update(schema.users)
                   *	.set({
                   *	  name: args.newName,
                   * 	})
                   *	.where(
                   *	  and(
                   *	    eq(schema.users.id, args.userId),
                   *	    (await ctx.abilities.users.filter("update")).sql.where,
                   *	  ),
                   *	);
                   * ```
                   *
                   */
                  sql: {
                    get where() {
                      return sqlTransformedWhere();
                    },
                  },
                };
              } else {
                return {
                  /**
                   * Query filters for the drizzle query API.
                   * @example
                   * ```ts
                   * author: t.relation("author", {
                   *  query: async (_args, ctx) => (await ctx.abilities.users.filter("read")).query.single,
                   * }),
                   * ´´´
                   */
                  query: {
                    /**
                     * For find first calls
                     */
                    single: {
                      extras: filters?.extras,
                      where: sanitizeFilterValue(filters?.where),
                    } as Pick<
                      NonNullable<
                        NonNullable<
                          Parameters<DB["query"][TableName]["findFirst"]>[0]
                        >
                      >,
                      "where"
                    >,
                    /**
                     * For find many calls
                     */
                    many: {
                      extras: filters?.extras,
                      where: sanitizeFilterValue(filters?.where),
                      get limit() {
                        return limit();
                      },
                    } as Pick<
                      NonNullable<
                        NonNullable<
                          Parameters<DB["query"][TableName]["findMany"]>[0]
                        >
                      >,
                      "where" | "limit"
                    >,
                  },
                  /**
                   * Query filters for the drizzle SQL API as used in e.g. updates.
                   * @example
                   *
                   * ```ts
                   * await db
                   *	.update(schema.users)
                   *	.set({
                   *	  name: args.newName,
                   * 	})
                   *	.where(
                   *	  and(
                   *	    eq(schema.users.id, args.userId),
                   *	    (await ctx.abilities.users.filter("update")).sql.where,
                   *	  ),
                   *	);
                   * ```
                   *
                   */
                  sql: {
                    get where() {
                      return sqlTransformedWhere();
                    },
                  },
                };
              }
            };

            const ret = internalTransformer(queryFilters);

            /**
             * Merges the current query filters with the provided filters for this call only
             */
            function merge(
              p: NonNullable<DrizzleQueryFunctionInput<DB, TableName>>,
            ) {
              const merged = mergeFilters(ret.query.many, p);
              return internalTransformer(
                merged,
                // in case the user wants to inject a limit, we need to ensure that it is applied
                // and not the potential default limit will be used
                // this is important for functions of the default query pagination implementation
                p.limit as number | undefined,
              );
            }

            (ret as any).merge = merge;
            (ret as any)[columnMaskKey] = columnMask;

            return ret as typeof ret & {
              merge: typeof merge;
            };
          }

          return {
            withContext: (userContext: UserContext) => {
              const prepare = (action: Action) => {
                const assembleAbilities = async (
                  attributes: Record<string, AttributeValue>,
                ) => {
                  const filters = queryFilters.get(action);

                  // in case we have a wildcard ability, skip the rest and return no filters at all
                  if (filters === "unrestricted") {
                    attributes[ATTR_ABILITIES_STATUS] = "unrestricted";
                    return transformToResponse();
                  }

                  // if nothing has been allowed, block everything
                  if (!filters) {
                    attributes[ATTR_ABILITIES_STATUS] = "blocked_everything";
                    nothingRegisteredWarningLogger(String(tableName), action);
                    return transformToResponse(blockEverythingFilter);
                  }

                  // run all dynamic filters, they may be async so we start all of them first
                  const rawResults = await Promise.all(
                    dynamicQueryFilters[action].map((func) =>
                      func(userContext),
                    ),
                  );

                  // if one of the dynamic filters returns "allow", we want to allow everything
                  if (rawResults.includes("allow")) {
                    attributes[ATTR_ABILITIES_STATUS] = "unrestricted";
                    return transformToResponse();
                  }

                  // if nothing is returned, nothing is allowed by this filter
                  const dynamicResults = rawResults.filter(
                    (r): r is Exclude<typeof r, undefined | "allow"> =>
                      r !== undefined,
                  ) as DrizzleQueryFunctionInput<DB, TableName>[];

                  attributes[ATTR_ABILITIES_DYNAMIC] = dynamicResults.length;
                  attributes[ATTR_ABILITIES_STATIC] =
                    simpleQueryFilters[action].length;

                  const allQueryFilters = [
                    ...simpleQueryFilters[action],
                    ...dynamicResults,
                  ];

                  attributes[ATTR_ABILITIES_TOTAL] = allQueryFilters.length;

                  // if we don't have any permitted filters then block everything
                  if (allQueryFilters.length === 0) {
                    attributes[ATTR_ABILITIES_STATUS] = "blocked_everything";

                    return transformToResponse(blockEverythingFilter);
                  }

                  const mergedFilters = (
                    allQueryFilters.length === 1
                      ? { ...allQueryFilters[0] }
                      : allQueryFilters.reduce((a, b) => {
                          return mergeFilters(a, b, "OR");
                        })
                  ) as Record<string, any>;

                  const { columns, extras, mask } = resolveColumnAccess(
                    action,
                    allQueryFilters,
                  );
                  if (columns) {
                    mergedFilters.columns = columns;
                  } else {
                    delete mergedFilters.columns;
                  }
                  if (extras) {
                    mergedFilters.extras = {
                      ...mergedFilters.extras,
                      ...extras,
                    };
                  }

                  attributes[ATTR_ABILITIES_STATUS] = "applied";
                  return transformToResponse(mergedFilters as any, mask);
                };

                // one attribute set, fed to both sinks, so a trace and a log
                // line describing the same ability check cannot disagree
                const run = async (span?: Span) => {
                  const attributes: Record<string, AttributeValue> = {
                    [ATTR_TABLE]: String(tableName),
                    [ATTR_ACTION]: action,
                  };

                  try {
                    const result = await assembleAbilities(attributes);
                    log?.debug(
                      {
                        ...attributes,
                        ...traceCorrelationFields(telemetryConfig, span),
                      },
                      "abilities prepared",
                    );
                    return result;
                  } catch (error) {
                    recordSpanError(span, error);
                    log?.error(
                      {
                        ...attributes,
                        ...traceCorrelationFields(telemetryConfig, span),
                        ...errorLogField(error),
                      },
                      "abilities failed",
                    );
                    throw error;
                  } finally {
                    span?.setAttributes(attributes);
                  }
                };

                if (otel?.enabled && otel.tracer) {
                  return otel.tracer.startActiveSpan(
                    SPAN_ABILITIES_PREPARE,
                    async (span) => {
                      try {
                        return await run(span);
                      } finally {
                        span.end();
                      }
                    },
                  );
                }

                return run();
              };

              // abilities are resolved once per request and action, since
              // filter() is called by every field and the (possibly async)
              // callbacks may be expensive, e.g. calling an external service
              const cache = new Map<Action, ReturnType<typeof prepare>>();
              const resolved = new Map<
                Action,
                Awaited<ReturnType<typeof prepare>>
              >();

              const abilities = {
                filter: (action: Action) => {
                  let prepared = cache.get(action);
                  if (!prepared) {
                    prepared = guardAgainstMissingAwait(prepare(action));
                    cache.set(action, prepared);
                    prepared.then(
                      (result) => resolved.set(action, result),
                      () => {},
                    );
                  }
                  return prepared;
                },
              };
              (abilities as any)[resolvedFilterKey] = (action: Action) =>
                resolved.get(action);
              return abilities;
            },
          };
        };

        const abilitiesPerTable = Object.fromEntries(
          tableRelationNames.map((tableName) => [
            tableName,
            createFilterForTable(tableName),
          ]),
        ) as {
          [key in TableNames]: ReturnType<typeof createFilterForTable<key>>;
        };

        hasBeenBuilt = true;

        return (ctx: UserContext) => {
          return Object.fromEntries(
            tableRelationNames.map((tableName) => [
              tableName,
              abilitiesPerTable[tableName].withContext(ctx),
            ]),
          ) as {
            [key in TableNames]: ReturnType<
              ReturnType<typeof createFilterForTable<key>>["withContext"]
            >;
          };
        };
      },
    },
  };
};
