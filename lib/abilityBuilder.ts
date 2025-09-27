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
			| "unset"
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
						filters = "unset";
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
							if (queryFilters.get(action) === "unset") {
								queryFilters.set(action, []);
							}
							const filters = queryFilters.get(action)!;
							(filters as Exclude<typeof filters, "unset">).push(queryFilter);
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

	const blockEverythingFilterCache = new Map<TableNames, any>();

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
			buildWithUserContext: (userContext: UserContext) => {
				const createFilterForTable = <TableName extends TableNames>(
					tableName: TableName,
				) => {
					const queryFilters = buildersPerTable[tableName]._.queryFilters;

					/**
					 * Creates a filter that will never return any result
					 */
					const getBlockEverythingFilter = () => {
						if (blockEverythingFilterCache.has(tableName)) {
							return blockEverythingFilterCache.get(tableName);
						}
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

						// when the user has no permission for anything, ensure returns nothing
						const r = {
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

						blockEverythingFilterCache.set(tableName, r);
						return r;
					};

					return {
						filter: (action: Action) => {
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

							let filters = queryFilters.get(action);

							// in case we have a wildcard ability, skip the rest and only apply the injected
							// filters, if any
							if (filters === "unset") {
								return transformToResponse();
							}

							// if nothing has been allowed, block everything
							if (!filters) {
								nothingRegisteredWarningLogger(tableName.toString(), action);
								filters = [getBlockEverythingFilter()];
							}

							//TODO: we could maybe improve performance by not filtering at each creation
							// but instead while the user sets the abilities
							const simpleQueryFilters: StaticQueryFilter<
								DB,
								TableName,
								QueryFilterInput<DB, TableName>
							>[] = filters.filter(isStaticQueryFilter);

							const functionQueryFilters: ReturnType<
								DynamicQueryFilter<
									DB,
									TableName,
									QueryFilterInput<DB, TableName>,
									UserContext
								>
							>[] = filters
								.filter(isDynamicQueryFilter)
								.map((queryFilter) => queryFilter(userContext));

							//TODO: we could save some work by not running all the filters at each request
							// whenever one already returned "allowed"
							const someWildcardFound = functionQueryFilters.some(
								(c) => c === "allow",
							);

							let allQueryFilters = [
								...simpleQueryFilters,
								...functionQueryFilters,
							]
								// we just ignore the ones who did return undefined, since that evaluates to "allow nothing"
								.filter((e) => e !== undefined)
								// we already checked if we have some wildcard, so we can ignore the wildcard entries from now on
								.filter((e) => e !== "allow");

							// if we don't have any permitted filters and don't have a wildcard, then block everything
							if (!someWildcardFound && allQueryFilters.length === 0) {
								allQueryFilters = [getBlockEverythingFilter()];
							}

							let highestLimit: number | undefined;
							for (const conditionObject of allQueryFilters) {
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
							for (const conditionObject of [
								...allQueryFilters,
								options?.inject,
							]) {
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
