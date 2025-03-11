import { and, eq, or } from "drizzle-orm";
import type {
	GenericDrizzleDbTypeConstraints,
	QueryConditionObject,
} from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type { RumbleInput } from "./types/rumbleInput";

export type AbilityBuilderType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
> = ReturnType<
	typeof createAbilityBuilder<UserContext, DB, RequestEvent, Action>
>;

type Condition<DBParameters, UserContext> =
	| SimpleCondition<DBParameters>
	| SyncFunctionCondition<DBParameters, UserContext>;
// | AsyncFunctionCondition<DBParameters, UserContext>;

type SimpleCondition<DBParameters> = DBParameters;
type SyncFunctionCondition<DBParameters, UserContext> = (
	context: UserContext,
) => DBParameters;
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
>({
	db,
}: RumbleInput<UserContext, DB, RequestEvent, Action>) => {
	type DBQueryKey = keyof DB["query"];
	type DBParameters = Parameters<DB["query"][DBQueryKey]["findMany"]>[0];

	const schema = db._.schema as NonNullable<DB["_"]["schema"]>;

	const builder: {
		[key in DBQueryKey]: ReturnType<typeof createEntityObject>;
	} = {} as any;

	const registeredConditions: {
		[key in DBQueryKey]: {
			[key in Action[number]]: (
				| QueryConditionObject
				| ((context: UserContext) => QueryConditionObject)
			)[];
			// | ((context: UserContext) => Promise<QueryConditionObject>)
		};
	} = {} as any;

	const createEntityObject = (entityKey: DBQueryKey) => ({
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
					conditionsPerEntityAndAction = [];
					conditionsPerEntity[action] = conditionsPerEntityAndAction;
				}
			}

			return {
				when: (condition: Condition<DBParameters, UserContext>) => {
					for (const action of actions) {
						const conditionsPerEntityAndAction = conditionsPerEntity[action];
						conditionsPerEntityAndAction.push(condition);
					}
				},
			};
		},
	});

	for (const entityKey of Object.keys(db.query) as DBQueryKey[]) {
		builder[entityKey] = createEntityObject(entityKey);
	}
	return {
		...builder,
		registeredConditions,
		buildWithUserContext: (userContext: UserContext) => {
			const builder: {
				[key in DBQueryKey]: ReturnType<typeof createEntityObject>;
			} = {} as any;

			const createEntityObject = (entityKey: DBQueryKey) => ({
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

					if (!conditionsPerEntity || !conditionsPerEntityAndAction) {
						const primaryKeyField = schema[entityKey].primaryKey.at(0);
						if (!primaryKeyField) {
							throw new RumbleError(
								`No primary key found for entity ${entityKey.toString()}`,
							);
						}

						conditionsPerEntityAndAction = [
							{
								where: and(eq(primaryKeyField, "1"), eq(primaryKeyField, "2")),
							},
						];
					}

					const simpleConditions =
						conditionsPerEntityAndAction.filter(isSimpleCondition);

					const syncFunctionConditions = conditionsPerEntityAndAction
						.filter(isSyncFunctionCondition)
						.map((condition) => condition(userContext));

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

					let highestLimit = undefined;
					for (const conditionObject of allConditionObjects) {
						if (conditionObject.limit) {
							if (
								highestLimit === undefined ||
								conditionObject.limit > highestLimit
							) {
								highestLimit = conditionObject.limit;
							}
						}
					}

					if (options?.inject?.limit && highestLimit < options.inject.limit) {
						highestLimit = options.inject.limit;
					}

					let combinedAllowedColumns: Record<string, any> | undefined =
						undefined;
					for (const conditionObject of [
						...allConditionObjects,
						options?.inject ?? {},
					]) {
						if (conditionObject.columns) {
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

					const accumulatedWhereConditions = allConditionObjects
						.filter((o) => o.where)
						.map((o) => o.where);

					let combinedWhere =
						accumulatedWhereConditions.length > 0
							? or(...accumulatedWhereConditions)
							: undefined;

					if (options?.inject?.where) {
						combinedWhere = combinedWhere
							? and(combinedWhere, options.inject.where)
							: options.inject.where;
					}

					const ret = {
						where: combinedWhere,
						columns: combinedAllowedColumns,
						limit: highestLimit,
					};

					//TODO make this typesafe per actual entity
					return ret;
				},
			});

			for (const entityKey of Object.keys(db.query) as DBQueryKey[]) {
				builder[entityKey] = createEntityObject(entityKey);
			}

			return builder;
		},
	};
};
