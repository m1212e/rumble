import type { DrizzleClient } from "@pothos/plugin-drizzle";

export type QueryConditionObject = Partial<{
	where: any;
	columns: any;
	limit: any;
}>;

export type GenericDrizzleDbTypeConstraints = {
	query: {
		[key: string]: {
			findMany: (P: QueryConditionObject) => any;
		};
	};
} & DrizzleClient;
