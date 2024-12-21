import type {
	GenericDrizzleDbTypeConstraints,
	QueryConditionObject,
} from "../types/genericDrizzleDbType";

export type AbilityBuilder = ReturnType<typeof createAbilityBuilder>;

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
				| ((context: UserContext) => Promise<QueryConditionObject>)
			)[];
		};
	} = {} as any;

	const createEntityObject = (entityKey: DBEntityKey) => ({
		allow: (action: Action) => {
			type DBParameters = Parameters<DB["query"][DBEntityKey]["findMany"]>[0];
			type Condition =
				| DBParameters
				| ((context: UserContext) => DBParameters)
				| ((context: UserContext) => Promise<DBParameters>);
			return {
				when: (condition: Condition) => {
					let conditionsPerEntity = registeredConditions[entityKey];
					if (!conditionsPerEntity) {
						conditionsPerEntity = {} as any;
						registeredConditions[entityKey] = conditionsPerEntity;
					}

					let conditionsPerEntityAndAction = conditionsPerEntity[action];
					if (!conditionsPerEntityAndAction) {
						conditionsPerEntityAndAction = [];
						conditionsPerEntity[action] = conditionsPerEntityAndAction;
					}

					conditionsPerEntityAndAction.push(condition);
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
	};
};
