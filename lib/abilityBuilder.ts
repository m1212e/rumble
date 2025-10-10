import { relationsFilterToSQL } from "drizzle-orm";
import { debounce } from "es-toolkit";
import { lazy } from "./helpers/lazy";
import { mergeFilters } from "./helpers/mergeFilters";
import { createDistinctValuesFromSQLType } from "./helpers/sqlTypes/distinctValuesFromSQLType";
import { tableHelper } from "./helpers/tableHelpers";
import type { Filter } from "./runtimeFiltersPlugin/pluginTypes";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
  DrizzleQueryFunctionInput,
  DrizzleTableValueType,
} from "./types/drizzleInstanceType";
import { RumbleError } from "./types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";

//TODO: optimize this for v8 & refactor

export type AbilityBuilderType<
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
) => StaticQueryFilter<DB, Table, Filter> | undefined | "allow";

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
  return (
    typeof filter === "function" && filter.constructor.name !== "AsyncFunction"
  );
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

const nothingRegisteredWarningLogger = debounce(
  (model: string, action: string) => {
    console.warn(`
Warning! No abilities have been registered for

    ${model}/${action}

but has been accessed. This will block everything. If this is intended, you can ignore this warning. If not, please ensure that you register the ability in your ability builder.
`);
  },
  1000,
);

export const createAbilityBuilder = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>({
  db,
  actions,
  defaultLimit,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>) => {
  type TableNames = keyof DrizzleQueryFunction<DB>;

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
      Filter<UserContext, any>[]
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
        for (const action of actions) {
          let filters = queryFilters.get(action);
          if (!filters) {
            filters = "unrestricted";
            queryFilters.set(action, filters);
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
                queryFilters.set(action, []);
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
              runtimeFilters.get(action)!.push(explicitFilter);
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
    (Object.keys(db.query) as TableNames[]).map((tableName) => [
      tableName,
      createBuilderForTable<typeof tableName>(),
    ]),
  ) as {
    [key in TableNames]: ReturnType<typeof createBuilderForTable<key>>;
  };

  return {
    ...buildersPerTable,
    /**
     * @internal
     * @ignore
     */
    _: {
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
              `No primary key found for entity ${tableName.toString()}`,
            );
          }

          const primaryKeyField = Object.values(tableSchema.primaryKey)[0];
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

          /**
           * Packs the filters into a response object that can be applied for queries by the user
           */
          function transformToResponse(
            queryFilters?: DrizzleQueryFunctionInput<DB, TableName>,
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
                return filters?.where
                  ? relationsFilterToSQL(
                      tableSchema.foundRelation.table,
                      filters.where,
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
                   *  query: (_args, ctx) => ctx.abilities.users.filter("read").query.single,
                   * }),
                   * ´´´
                   */
                  query: {
                    /**
                     * For find first calls
                     */
                    single: {
                      where: filters?.where,
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
                      where: filters?.where,
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
                   *	    ctx.abilities.users.filter("update").sql.where,
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
                   *  query: (_args, ctx) => ctx.abilities.users.filter("read").query.single,
                   * }),
                   * ´´´
                   */
                  query: {
                    /**
                     * For find first calls
                     */
                    single: {
                      where: filters?.where,
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
                      where: filters?.where,
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
                   *	    ctx.abilities.users.filter("update").sql.where,
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

            return ret as typeof ret & {
              merge: typeof merge;
            };
          }

          return {
            withContext: (userContext: UserContext) => {
              return {
                filter: (action: Action) => {
                  const filters = queryFilters.get(action);

                  // in case we have a wildcard ability, skip the rest and return no filters at all
                  if (filters === "unrestricted") {
                    return transformToResponse();
                  }

                  // if nothing has been allowed, block everything
                  if (!filters) {
                    nothingRegisteredWarningLogger(
                      tableName.toString(),
                      action,
                    );
                    return transformToResponse(blockEverythingFilter);
                  }

                  // run all dynamic filters
                  const dynamicResults = new Array<
                    DrizzleQueryFunctionInput<DB, TableName>
                  >(dynamicQueryFilters[action].length);
                  let filtersReturned = 0;
                  for (let i = 0; i < dynamicQueryFilters[action].length; i++) {
                    const func = dynamicQueryFilters[action][i];
                    const result = func(userContext);
                    // if one of the dynamic filters returns "allow", we want to allow everything
                    if (result === "allow") {
                      return transformToResponse();
                    }
                    // if nothing is returned, nothing is allowed by this filter
                    if (result === undefined) continue;

                    dynamicResults[filtersReturned++] = result;
                  }
                  dynamicResults.length = filtersReturned;

                  const allQueryFilters = [
                    ...simpleQueryFilters[action],
                    ...dynamicResults,
                  ];

                  // if we don't have any permitted filters then block everything
                  if (allQueryFilters.length === 0) {
                    return transformToResponse(blockEverythingFilter);
                  }

                  const mergedFilters =
                    allQueryFilters.length === 1
                      ? allQueryFilters[0]
                      : allQueryFilters.reduce((a, b) => {
                          return mergeFilters(a, b);
                        }, {});

                  return transformToResponse(mergedFilters as any);
                },
              };
            },
          };
        };

        const abilitiesPerTable = Object.fromEntries(
          (Object.keys(db.query) as TableNames[]).map((tableName) => [
            tableName,
            createFilterForTable(tableName),
          ]),
        ) as {
          [key in TableNames]: ReturnType<typeof createFilterForTable<key>>;
        };

        hasBeenBuilt = true;

        return (ctx: UserContext) => {
          return Object.fromEntries(
            (Object.keys(abilitiesPerTable) as TableNames[]).map(
              (tableName) => [
                tableName,
                abilitiesPerTable[tableName].withContext(ctx),
              ],
            ),
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
