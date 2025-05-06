import type { DrizzleClient } from "@pothos/plugin-drizzle";

export type QueryFilterObject = Partial<{
	where: any;
	columns: any;
	limit: any;
}>;

export type GenericDrizzleDbTypeConstraints = {
	query: {
		[key: string]: {
			findMany: (P: QueryFilterObject) => any;
			findFirst: (P: QueryFilterObject) => any;
		};
	};
} & DrizzleClient;
