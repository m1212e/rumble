import { and, eq, or } from "drizzle-orm";
import type { Filter } from "./explicitFiltersPlugin/pluginTypes";
import { createDistinctValuesFromSQLType } from "./helpers/sqlTypes/distinctValuesFromSQLType";
import type {
	GenericDrizzleDbTypeConstraints,
	QueryConditionObject,
} from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

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

type Condition<DBParameters, UserContext> =
	| SimpleCondition<DBParameters>
	| SyncFunctionCondition<DBParameters, UserContext>;
// | AsyncFunctionCondition<DBParameters, UserContext>;

type SimpleCondition<DBParameters> = DBParameters;
type SyncFunctionCondition<DBParameters, UserContext> = (
	context: UserContext,
) => DBParameters | undefined | "allow";
// type AsyncFunctionCondition<DBParameters, UserContext> = (
// 	context: UserContext,
// ) => Promise<DBParameters>;

// type guards for the condition types
function isSimpleCondition<DBParameters, UserContext>(
	condition: Condition<DBParameters, UserContext>,
): condition is SimpleCondition<DBParameters> {
	return typeof condition !== "function";
}

function isSyncFunctionCondition<DBParameters, UserContext>(
	condition: Condition<DBParameters, UserContext>,
): condition is SyncFunctionCondition<DBParameters, UserContext> {
	return (
		typeof condition === "function" &&
		condition.constructor.name !== "AsyncFunction"
	);
}

// function isAsyncFunctionCondition<DBParameters, UserContext>(
// 	condition: Condition<DBParameters, UserContext>,
// ): condition is AsyncFunctionCondition<DBParameters, UserContext> {
// 	return (
// 		typeof condition === "function" &&
// 		condition.constructor.name === "AsyncFunction"
// 	);
// }

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
	type DBQueryKey = keyof DB["query"];
	type DBParameters = Parameters<DB["query"][DBQueryKey]["findMany"]>[0];

	const schema = db._.schema as NonNullable<DB["_"]["schema"]>;

	const registrators: {
		[key in DBQueryKey]: ReturnType<typeof createRegistrator<key>>;
	} = {} as any;

	const registeredConditions: {
		[key in DBQueryKey]: {
			[key in Action]:
				| (
						| QueryConditionObject
						| ((
								context: UserContext,
						  ) => QueryConditionObject | undefined | "allow")
				  )[]
				| "wildcard";
			// | ((context: UserContext) => Promise<QueryConditionObject>)
		};
	} = {} as any;

	const registeredFilters: {
		[key in DBQueryKey]: {
			//TODO add a run all helper
			[key in Action]: Filter<UserContext, any>[];
		};
	} = {} as any;

	const createRegistrator = <EntityKey extends DBQueryKey>(
		entityKey: EntityKey,
	) => {
		// we want to init all possible application level filters since we want to ensure
		// that the implementaiton helpers pass an object by reference when creating
		// the implementation, instead of a copy like it would be the case with undefined
		for (const action of actions!) {
			if (!registeredFilters[entityKey]) {
				registeredFilters[entityKey] = {} as any;
			}
			if (!registeredFilters[entityKey][action]) {
				registeredFilters[entityKey][action] = [];
			}
		}

		return {
			allow: (action: Action | Action[]) => {
				let conditionsPerEntity = registeredConditions[entityKey];
				if (!conditionsPerEntity) {
					conditionsPerEntity = {} as any;
					registeredConditions[entityKey] = conditionsPerEntity;
				}

				const actions = Array.isArray(action) ? action : [action];
				for (const action of actions) {
					let conditionsPerEntityAndAction = conditionsPerEntity[action];
					if (!conditionsPerEntityAndAction) {
						conditionsPerEntityAndAction = "wildcard";
						conditionsPerEntity[action] = conditionsPerEntityAndAction;
					}
				}

				return {
					when: (condition: Condition<DBParameters, UserContext>) => {
						for (const action of actions) {
							if (conditionsPerEntity[action] === "wildcard") {
								conditionsPerEntity[action] = [];
							}
							const conditionsPerEntityAndAction = conditionsPerEntity[action];
							(
								conditionsPerEntityAndAction as Exclude<
									typeof conditionsPerEntityAndAction,
									"wildcard"
								>
							).push(condition);
						}
					},
				};
			},
			filter: (action: Action | Action[]) => {
				const actions = Array.isArray(action) ? action : [action];
				return {
					by: (
						explicitFilter: Filter<
							UserContext,
							NonNullable<
								Awaited<ReturnType<DB["query"][EntityKey]["findFirst"]>>
							>
						>,
					) => {
						for (const action of actions) {
							registeredFilters[entityKey][action].push(explicitFilter);
						}
					},
				};
			},
		};
	};

	for (const entityKey of Object.keys(db.query) as DBQueryKey[]) {
		registrators[entityKey] = createRegistrator(entityKey);
	}
	return {
		...registrators,
		registeredConditions,
		registeredFilters,
		buildWithUserContext: (userContext: UserContext) => {
			const builder: {
				[key in DBQueryKey]: ReturnType<typeof createEntityObject<key>>;
			} = {} as any;

			const createEntityObject = <Key extends DBQueryKey>(entityKey: Key) => ({
				filter: (
					action: Action,
					options?: {
						/**
						 * Additional conditions applied only for this call. Useful for injecting one time additional filters
						 * for e.g. user args in a handler.
						 */
						inject?: QueryConditionObject;
					},
				) => {
					let conditionsPerEntity = registeredConditions[entityKey];
					if (!conditionsPerEntity) {
						conditionsPerEntity = {} as any;
					}

					let conditionsPerEntityAndAction = conditionsPerEntity[action];

					// in case we have a wildcard ability, skip the rest and only apply the injected
					// filters, if any
					if (conditionsPerEntityAndAction === "wildcard") {
						// the undefined type casts are not exactly correct
						// but prevent TS from doing weird things with the return
						// types of the query function with these filters applied
						return {
							single: {
								where: options?.inject?.where as undefined,
								columns: options?.inject?.columns as undefined,
							},
							many: {
								where: options?.inject?.where as undefined,
								columns: options?.inject?.columns as undefined,
								limit: (options?.inject?.limit ??
									defaultLimit ??
									undefined) as undefined,
							},
						};
					}

					const getBlockEverythingFilter = () => {
						const primaryKeyField = schema[entityKey].primaryKey.at(0);
						if (!primaryKeyField) {
							throw new RumbleError(
								`No primary key found for entity ${entityKey.toString()}`,
							);
						}

						// we want a filter that excludes everything
						const distinctValues = createDistinctValuesFromSQLType(
							primaryKeyField.getSQLType(),
						);

						// when the user has no permission for anything, ensure returns nothing
						return {
							where: and(
								eq(primaryKeyField, distinctValues.value1),
								eq(primaryKeyField, distinctValues.value2),
							),
						};
					};

					if (!conditionsPerEntity || !conditionsPerEntityAndAction) {
						conditionsPerEntityAndAction = [getBlockEverythingFilter()];
					}

					//TODO: we could maybe improve performance by not filtering at each creation
					// but instead while the user sets the abilities
					const simpleConditions =
						conditionsPerEntityAndAction.filter(isSimpleCondition);

					const syncFunctionConditions = conditionsPerEntityAndAction
						.filter(isSyncFunctionCondition)
						.map((condition) => condition(userContext));

					const someWildcardFound = syncFunctionConditions.some(
						(c) => c === "allow",
					);

					// const asyncFunctionConditions = await Promise.all(
					// 	conditionsPerEntityAndAction
					// 		.filter(isAsyncFunctionCondition)
					// 		.map((condition) => condition(userContext)),
					// );

					const allConditionObjects = [
						...simpleConditions,
						...syncFunctionConditions,
						// ...asyncFunctionConditions,
					];

					// if we don't have any permitted filters and don't have a wildcard, then block everything
					if (allConditionObjects.filter((o) => o !== undefined).length === 0) {
						allConditionObjects.push(getBlockEverythingFilter());
					}

					let highestLimit: number | undefined = undefined;
					for (const conditionObject of allConditionObjects) {
						if (conditionObject !== "allow" && conditionObject?.limit) {
							if (
								highestLimit === undefined ||
								conditionObject.limit > highestLimit
							) {
								highestLimit = conditionObject.limit;
							}
						}
					}

					if (
						options?.inject?.limit &&
						highestLimit &&
						highestLimit < options.inject.limit
					) {
						highestLimit = options.inject.limit;
					}

					let combinedAllowedColumns: Record<string, any> | undefined =
						undefined;
					for (const conditionObject of [
						...allConditionObjects,
						options?.inject ?? {},
					]) {
						if (conditionObject !== "allow" && conditionObject?.columns) {
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
						: allConditionObjects
								.filter((o) => o !== "allow" && o?.where)
								.map((o) => (o as Exclude<typeof o, "allow">)?.where);

					let combinedWhere =
						accumulatedWhereConditions.length > 0
							? or(...accumulatedWhereConditions)
							: undefined;

					if (options?.inject?.where) {
						combinedWhere = combinedWhere
							? and(combinedWhere, options.inject.where)
							: options.inject.where;
					}

					//TODO make this actually typesafe
					return {
						single: {
							where: combinedWhere,
							columns: combinedAllowedColumns,
						},
						many: {
							where: combinedWhere,
							columns: combinedAllowedColumns,
							limit: highestLimit ?? defaultLimit ?? undefined,
						},
					};
				},
				explicitFilters: (action: Action) => {
					return registeredFilters[entityKey][action];
				},
			});

			for (const entityKey of Object.keys(db.query) as DBQueryKey[]) {
				builder[entityKey] = createEntityObject(entityKey);
			}

			return builder;
		},
	};
};
