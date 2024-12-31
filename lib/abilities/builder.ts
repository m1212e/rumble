import { or } from "drizzle-orm";
import type {
	GenericDrizzleDbTypeConstraints,
	QueryConditionObject,
} from "../types/genericDrizzleDbType";

export type AbilityBuilder = ReturnType<typeof createAbilityBuilder>;

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
	Action extends string = "create" | "read" | "update" | "delete",
>({
	db,
	actions = ["create", "read", "update", "delete"] as Action[],
}: {
	db: DB;
	actions?: Action[];
}) => {
	type DBEntityKey = keyof DB["query"];

	const builder: {
		[key in DBEntityKey]: ReturnType<typeof createEntityObject>;
	} = {} as any;

	const registeredConditions: {
		[key in DBEntityKey]: {
			[key in Action[number]]: (
				| QueryConditionObject
				| ((context: UserContext) => QueryConditionObject)
			)[];
			// | ((context: UserContext) => Promise<QueryConditionObject>)
		};
	} = {} as any;

	const createEntityObject = (entityKey: DBEntityKey) => ({
		allow: (action: Action | Action[]) => {
			type DBParameters = Parameters<DB["query"][DBEntityKey]["findMany"]>[0];

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

	for (const entityKey of Object.keys(db.query) as DBEntityKey[]) {
		builder[entityKey] = createEntityObject(entityKey);
	}
	return {
		...builder,
		registeredConditions,
		buildWithUserContext: (userContext: UserContext) => {
			const builder: {
				[key in DBEntityKey]: ReturnType<typeof createEntityObject>;
			} = {} as any;

			const createEntityObject = (entityKey: DBEntityKey) => ({
				filter: (action: Action) => {
					const conditionsPerEntity = registeredConditions[entityKey];
					if (!conditionsPerEntity) {
						throw "TODO (No allowed entry found for this condition) #1";
					}

					const conditionsPerEntityAndAction = conditionsPerEntity[action];
					if (!conditionsPerEntityAndAction) {
						throw "TODO (No allowed entry found for this condition) #2";
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

					let combinedAllowedColumns: Record<string, any> | undefined =
						undefined;
					for (const conditionObject of allConditionObjects) {
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

					const combinedWhere =
						accumulatedWhereConditions.length > 0
							? or(...accumulatedWhereConditions)
							: undefined;

					return {
						where: combinedWhere,
						columns: combinedAllowedColumns,
						limit: highestLimit,
					};
				},
			});

			for (const entityKey of Object.keys(db.query) as DBEntityKey[]) {
				builder[entityKey] = createEntityObject(entityKey);
			}

			return builder;
		},
	};
};
