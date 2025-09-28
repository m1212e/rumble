import { debounce } from "es-toolkit";
import { lazy } from "./helpers/lazy";
import { createDistinctValuesFromSQLType } from "./helpers/sqlTypes/distinctValuesFromSQLType";
import { tableHelper } from "./helpers/tableHelpers";
import type { Filter } from "./runtimeFiltersPlugin/pluginTypes";
import type {
  DrizzleInstance,
  DrizzleQueryFunction,
  DrizzleQueryFunctionInput,
  DrizzleQueryFunctionReturnType,
  InternalDrizzleInstance,
} from "./types/drizzleInstanceType";
import { RumbleError } from "./types/rumbleError";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";

//TODO: optimize this for v8 & refactor

export type AbilityBuilderType<
  UserContext extends Record<string, any>,
  DB extends InternalDrizzleInstance<DrizzleInstance>,
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
  DB extends InternalDrizzleInstance<DrizzleInstance>,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
>({
  db,
  actions,
  defaultLimit,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>) => {
  type TableNames = keyof DrizzleQueryFunction<DB>;

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
              NonNullable<
                Awaited<
                  ReturnType<
                    DrizzleQueryFunctionReturnType<DB, TableName>["findFirst"]
                  >
                >
              >
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
        )! as Filter<
          UserContext,
          NonNullable<
            Awaited<
              ReturnType<
                DrizzleQueryFunctionReturnType<DB, TableNames>["findFirst"]
              >
            >
          >
        >[];
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

          return {
            filter: ({
              action,
              userContext,
            }: {
              action: Action;
              userContext: UserContext;
            }) => {
              /**
               * Packs the filters into a response object that can be applied for queries by the user
               */
              // const transformToResponse = <
              // 	F extends QueryFilterInput<DB, TableName>,
              // >(
              // 	queryFilters?: F,
              // ) => {
              // 	const where = lazy(() => {
              // 		if (!queryFilters?.where && !options?.inject?.where) {
              // 			return;
              // 		}

              // 		if (options?.inject?.where && queryFilters?.where) {
              // 			return {
              // 				AND: [queryFilters?.where, options?.inject?.where],
              // 			};
              // 		}

              // 		if (options?.inject?.where && !queryFilters?.where) {
              // 			return options?.inject?.where;
              // 		}

              // 		if (!options?.inject?.where && queryFilters?.where) {
              // 			return queryFilters?.where;
              // 		}

              // 		if (!options?.inject?.where && !queryFilters?.where) {
              // 			return undefined;
              // 		}
              // 	});

              // 	const transformedWhere = lazy(() => {
              // 		const w = where();
              // 		if (!w) {
              // 			return;
              // 		}

              // 		const table = tableHelper({
              // 			table: tableName,
              // 			db,
              // 		});

              // 		return relationsFilterToSQL(table.tableSchema, w);
              // 	});

              // 	const limit = lazy(() => {
              // 		let limit =
              // 			queryFilters?.limit ?? (defaultLimit as undefined | number);

              // 		// only apply limit if neither default limit or ability limit are set
              // 		// or lower amount is set
              // 		if (
              // 			options?.inject?.limit &&
              // 			(!limit || limit > options.inject.limit)
              // 		) {
              // 			limit = options.inject.limit;
              // 		}

              // 		// ensure that null is converted to undefined
              // 		return limit ?? undefined;
              // 	});

              // 	const columns = lazy(() => {
              // 		if (!queryFilters?.columns && !options?.inject?.columns) {
              // 			return;
              // 		}

              // 		return {
              // 			...queryFilters?.columns,
              // 			...options?.inject?.columns,
              // 		} as undefined;
              // 		// we need to type this as undefined because TS would
              // 		// do some funky stuff with query resolve typing otherwise
              // 	});

              // 	const r = {
              // 		/**
              // 		 * Query filters for the drizzle query API.
              // 		 * @example
              // 		 * ```ts
              // 		 * author: t.relation("author", {
              // 		 *  query: (_args, ctx) => ctx.abilities.users.filter("read").query.single,
              // 		 * }),
              // 		 * ´´´
              // 		 */
              // 		query: {
              // 			/**
              // 			 * For find first calls
              // 			 */
              // 			single: {
              // 				get where() {
              // 					return where();
              // 				},
              // 				columns: columns(),
              // 			} as Pick<
              // 				NonNullable<
              // 					NonNullable<
              // 						Parameters<DB["query"][TableName]["findFirst"]>[0]
              // 					>
              // 				>,
              // 				"columns" | "where"
              // 			>,
              // 			/**
              // 			 * For find many calls
              // 			 */
              // 			many: {
              // 				get where() {
              // 					return where();
              // 				},
              // 				columns: columns(),
              // 				get limit() {
              // 					return limit();
              // 				},
              // 			} as Pick<
              // 				NonNullable<
              // 					NonNullable<
              // 						Parameters<DB["query"][TableName]["findMany"]>[0]
              // 					>
              // 				>,
              // 				"columns" | "where" | "limit"
              // 			>,
              // 		},
              // 		/**
              // 		 * Query filters for the drizzle SQL API as used in e.g. updates.
              // 		 * @example
              // 		 *
              // 		 * ```ts
              // 		 * await db
              // 		 *	.update(schema.users)
              // 		 *	.set({
              // 		 *	  name: args.newName,
              // 		 * 	})
              // 		 *	.where(
              // 		 *	  and(
              // 		 *	    eq(schema.users.id, args.userId),
              // 		 *	    ctx.abilities.users.filter("update").sql.where,
              // 		 *	  ),
              // 		 *	);
              // 		 * ```
              // 		 *
              // 		 */
              // 		sql: {
              // 			get where() {
              // 				return transformedWhere();
              // 			},
              // 			// TODO: check if there are any usecases for applying these
              // 			// columns: columns(),
              // 			// get limit() {
              // 			// 	RETURN LIMIT();
              // 			// },
              // 		},
              // 	};

              // 	// columns can't be set to undefined, drizzle will interpret this
              // 	// as: don't return any columns
              // 	// therefore we need to delete it
              // 	if (!columns()) {
              // 		// TODO: check todo above
              // 		// delete r.sql.columns;

              // 		// this should be removed, kills performance
              // 		delete r.query.many.columns;
              // 		delete r.query.single.columns;
              // 	}

              // 	return r;
              // };

              const filters = queryFilters.get(action);

              // in case we have a wildcard ability, skip the rest and return no filters at all
              if (filters === "unrestricted") {
                return transformToResponse();
              }

              // if nothing has been allowed, block everything
              if (!filters) {
                nothingRegisteredWarningLogger(tableName.toString(), action);
                return transformToResponse([blockEverythingFilter]);
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

                dynamicResults.push(result);
                filtersReturned++;
              }
              dynamicResults.length = filtersReturned;

              const allQueryFilters = [
                ...simpleQueryFilters[action],
                ...dynamicResults,
              ];

              // if we don't have any permitted filters then block everything
              if (allQueryFilters.length === 0) {
                return transformToResponse([blockEverythingFilter]);
              }

              let highestLimit: number | undefined;
              for (let i = 0; i < allQueryFilters.length; i++) {
                const conditionObject = allQueryFilters[i];
                if (conditionObject?.limit) {
                  if (
                    highestLimit === undefined ||
                    conditionObject.limit > highestLimit
                  ) {
                    highestLimit = conditionObject.limit;
                  }
                }
              }

              let combinedAllowedColumns: Record<string, any> | undefined;
              for (let i = 0; i < allQueryFilters.length; i++) {
                const conditionObject = allQueryFilters[i];
                if (conditionObject?.columns) {
                  if (combinedAllowedColumns === undefined) {
                    combinedAllowedColumns = conditionObject.columns;
                  } else {
                    combinedAllowedColumns = {
                      ...combinedAllowedColumns,
                      ...conditionObject.columns,
                    };
                  }
                }
              }

              // in case we have a wildcard, we don't want to apply any where conditions
              const accumulatedWhereConditions = someWildcardFound
                ? []
                : allQueryFilters.filter((o) => o?.where).map((o) => o.where);

              const combinedWhere =
                accumulatedWhereConditions.length > 0
                  ? { OR: accumulatedWhereConditions }
                  : undefined;

              return transformToResponse({
                where: combinedWhere,
                columns: combinedAllowedColumns,
                limit: highestLimit,
              });
            },
          };
        };

        return Object.fromEntries(
          (Object.keys(db.query) as TableNames[]).map((tableName) => [
            tableName,
            createFilterForTable(tableName),
          ]),
        ) as {
          [key in TableNames]: ReturnType<typeof createFilterForTable<key>>;
        };
      },
    },
  };
};
