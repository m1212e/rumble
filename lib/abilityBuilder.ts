import { relationsFilterToSQL } from "drizzle-orm";
import { debounce } from "es-toolkit";
import { lazy } from "./helpers/lazy";
import { createDistinctValuesFromSQLType } from "./helpers/sqlTypes/distinctValuesFromSQLType";
import { tableHelper } from "./helpers/tableHelpers";
import type { Filter } from "./runtimeFiltersPlugin/pluginTypes";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

//TODO: optimize this for v8 & refactor

export type AbilityBuilderType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
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

type TableName<DB extends GenericDrizzleDbTypeConstraints> = keyof DB["query"];

type QueryFilterInput<
	DB extends GenericDrizzleDbTypeConstraints,
	TableKey extends TableName<DB>,
> = Parameters<DB["query"][TableKey]["findMany"]>[0];

type SimpleQueryFilter<
	DB extends GenericDrizzleDbTypeConstraints,
	TableKey extends keyof DB["query"],
	Filter extends QueryFilterInput<DB, TableKey>,
> = Filter;

type FunctionQueryFilter<
	DB extends GenericDrizzleDbTypeConstraints,
	TableKey extends keyof DB["query"],
	Filter extends QueryFilterInput<DB, TableKey>,
	Context,
> = (context: Context) => Filter | undefined | "allow";

function isSimpleQueryFilter<
	DB extends GenericDrizzleDbTypeConstraints,
	TableKey extends keyof DB["query"],
	Filter extends QueryFilterInput<DB, TableKey>,
	Context,
>(
	filter: QueryFilter<DB, TableKey, Filter, Context>,
): filter is SimpleQueryFilter<DB, TableKey, Filter> {
	return typeof filter !== "function";
}

type QueryFilter<
	DB extends GenericDrizzleDbTypeConstraints,
	TableName extends keyof DB["query"],
	Filter extends QueryFilterInput<DB, TableName>,
	Context,
> =
	| SimpleQueryFilter<DB, TableName, Filter>
	| FunctionQueryFilter<DB, TableName, Filter, Context>;

function isFunctionFilter<
	DB extends GenericDrizzleDbTypeConstraints,
	TableKey extends keyof DB["query"],
	Filter extends QueryFilterInput<DB, TableKey>,
	Context,
>(
	filter: QueryFilter<DB, TableKey, Filter, Context>,
): filter is FunctionQueryFilter<DB, TableKey, Filter, Context> {
	return (
		typeof filter === "function" && filter.constructor.name !== "AsyncFunction"
	);
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
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
>({
	db,
	actions,
	defaultLimit,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig>) => {
	const registrators: {
		[key in TableName<DB>]: ReturnType<typeof createRegistrator<key>>;
	} = {} as any;

	const registeredQueryFilters: {
		[key in TableName<DB>]: {
			[key in Action]: QueryFilter<DB, key, any, UserContext>[] | "unspecified";
		};
	} = {} as any;

	const registeredRuntimeFilters: {
		[key in TableName<DB>]: {
			//TODO add a run all helper
			[key in Action]: Filter<UserContext, any>[];
		};
	} = {} as any;

	const createRegistrator = <TableNameT extends TableName<DB>>(
		tableName: TableNameT,
	) => {
		// we want to init all possible application level filters since we want to ensure
		// that the implementaiton helpers pass an object by reference when creating
		// the implementation, instead of a copy like it would be the case with undefined
		for (const action of actions!) {
			if (!registeredRuntimeFilters[tableName]) {
				registeredRuntimeFilters[tableName] = {} as any;
			}
			if (!registeredRuntimeFilters[tableName][action]) {
				registeredRuntimeFilters[tableName][action] = [];
			}
		}

		return {
			/**
			 * Allows to perform a specific action on a specific entity
			 */
			allow: (action: Action | Action[]) => {
				let queryFiltersPerEntity = registeredQueryFilters[tableName];
				if (!queryFiltersPerEntity) {
					queryFiltersPerEntity = {} as any;
					registeredQueryFilters[tableName] = queryFiltersPerEntity;
				}

				const actions = Array.isArray(action) ? action : [action];
				for (const action of actions) {
					let queryFiltersPerEntityAndAction = queryFiltersPerEntity[action];
					if (!queryFiltersPerEntityAndAction) {
						queryFiltersPerEntityAndAction = "unspecified";
						queryFiltersPerEntity[action] = queryFiltersPerEntityAndAction;
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
							TableNameT,
							QueryFilterInput<DB, TableNameT>,
							UserContext
						>,
					) => {
						for (const action of actions) {
							if (queryFiltersPerEntity[action] === "unspecified") {
								queryFiltersPerEntity[action] = [];
							}
							const queryFiltersPerEntityAndAction =
								queryFiltersPerEntity[action];
							(
								queryFiltersPerEntityAndAction as Exclude<
									typeof queryFiltersPerEntityAndAction,
									"unspecified"
								>
							).push(queryFilter);
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
								Awaited<ReturnType<DB["query"][TableNameT]["findFirst"]>>
							>
						>,
					) => {
						for (const action of actions) {
							registeredRuntimeFilters[tableName][action].push(explicitFilter);
						}
					},
				};
			},
		};
	};

	for (const entityKey of Object.keys(db.query) as TableName<DB>[]) {
		registrators[entityKey] = createRegistrator(entityKey);
	}

	return {
		...registrators,
		/**
		 * @internal
		 * @ignore
		 */
		z_registeredQueryFilters: registeredQueryFilters,
		/**
		 * @internal
		 * @ignore
		 */
		z_registeredFilters: registeredRuntimeFilters,
		/**
		 * @internal
		 * @ignore
		 */
		z_buildWithUserContext: (userContext: UserContext) => {
			const builder: {
				[key in TableName<DB>]: ReturnType<typeof createEntityObject<key>>;
			} = {} as any;

			const createEntityObject = <TableNameT extends TableName<DB>>(
				tableName: TableNameT,
			) => {
				return {
					filter: <
						Injection extends SimpleQueryFilter<
							DB,
							TableNameT,
							QueryFilterInput<DB, TableNameT>
						>,
					>(
						action: Action,
						options?: {
							/**
							 * Additional query filters applied only for this call. Useful for injecting one time additional filters
							 * for e.g. user args in a handler.
							 */
							inject?: Injection;
						},
					) => {
						/**
						 * Packs the filters into a response object that can be applied for queries by the user
						 */
						const transformToResponse = <
							F extends QueryFilterInput<DB, TableNameT>,
						>(
							queryFilters?: F,
						) => {
							const where = lazy(() => {
								if (!queryFilters?.where && !options?.inject?.where) {
									return;
								}

								if (options?.inject?.where && queryFilters?.where) {
									return {
										AND: [queryFilters?.where, options?.inject?.where],
									};
								}

								if (options?.inject?.where && !queryFilters?.where) {
									return options?.inject?.where;
								}

								if (!options?.inject?.where && queryFilters?.where) {
									return queryFilters?.where;
								}

								if (!options?.inject?.where && !queryFilters?.where) {
									return undefined;
								}
							});

							const transformedWhere = lazy(() => {
								const w = where();
								if (!w) {
									return;
								}

								const table = tableHelper({
									tsName: tableName,
									db,
								});

								return relationsFilterToSQL(table.tableSchema, w);
							});

							const limit = lazy(() => {
								let limit =
									queryFilters?.limit ?? (defaultLimit as undefined | number);

								// only apply limit if neither default limit or ability limit are set
								// or lower amount is set
								if (
									options?.inject?.limit &&
									(!limit || limit > options.inject.limit)
								) {
									limit = options.inject.limit;
								}

								if (
									queryFilters?.limit &&
									(!limit || queryFilters.limit > limit)
								) {
									limit = queryFilters.limit;
								}

								// ensure that null is converted to undefined
								return limit ?? undefined;
							});

							const columns = lazy(() => {
								if (!queryFilters?.columns && !options?.inject?.columns) {
									return;
								}

								return {
									...queryFilters?.columns,
									...options?.inject?.columns,
								} as undefined;
								// we need to type this as undefined because TS would
								// do some funky stuff with query resolve typing otherwise
							});

							const r = {
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
										get where() {
											return where();
										},
										columns: columns(),
									} as Pick<
										NonNullable<
											NonNullable<
												Parameters<DB["query"][TableNameT]["findFirst"]>[0]
											>
										>,
										"columns" | "where"
									>,
									/**
									 * For find many calls
									 */
									many: {
										get where() {
											return where();
										},
										columns: columns(),
										get limit() {
											return limit();
										},
									} as Pick<
										NonNullable<
											NonNullable<
												Parameters<DB["query"][TableNameT]["findMany"]>[0]
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
										return transformedWhere();
									},
									columns: columns(),
									get limit() {
										return limit();
									},
								},
							};

							// columns can't be set to undefined, drizzle will interpret this
							// as: don't return any columns
							// therefore we need to delete it
							if (!columns()) {
								delete r.sql.columns;
								delete r.query.many.columns;
								delete r.query.single.columns;
							}

							return r;
						};

						/**
						 * Creates a filter that will never return any result
						 */
						const getBlockEverythingFilter = () => {
							const tableSchema = tableHelper({
								db,
								tsName: tableName,
							});

							if (Object.keys(tableSchema.primaryColumns).length === 0) {
								throw new RumbleError(
									`No primary key found for entity ${tableName.toString()}`,
								);
							}

							const primaryKeyField = Object.values(
								tableSchema.primaryColumns,
							)[0];
							// we want a filter that excludes everything
							const distinctValues = createDistinctValuesFromSQLType(
								primaryKeyField.getSQLType() as any,
							);

							// when the user has no permission for anything, ensure returns nothing
							return {
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
						};

						let queryFiltersPerEntityAndAction =
							registeredQueryFilters?.[tableName]?.[action];

						// in case we have a wildcard ability, skip the rest and only apply the injected
						// filters, if any
						if (queryFiltersPerEntityAndAction === "unspecified") {
							return transformToResponse();
						}

						// if nothing has been allowed, block everything
						if (!queryFiltersPerEntityAndAction) {
							nothingRegisteredWarningLogger(tableName.toString(), action);
							queryFiltersPerEntityAndAction = [getBlockEverythingFilter()];
						}

						//TODO: we could maybe improve performance by not filtering at each creation
						// but instead while the user sets the abilities
						const simpleQueryFilters: SimpleQueryFilter<
							DB,
							TableNameT,
							QueryFilterInput<DB, TableNameT>
						>[] = queryFiltersPerEntityAndAction.filter(isSimpleQueryFilter);

						const functionQueryFilters: ReturnType<
							FunctionQueryFilter<
								DB,
								TableNameT,
								QueryFilterInput<DB, TableNameT>,
								UserContext
							>
						>[] = queryFiltersPerEntityAndAction
							.filter(isFunctionFilter)
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
					runtimeFilters: (action: Action) => {
						return registeredRuntimeFilters[tableName][action];
					},
				};
			};

			for (const entityKey of Object.keys(db.query) as TableName<DB>[]) {
				builder[entityKey] = createEntityObject(entityKey);
			}

			return builder;
		},
	};
};
