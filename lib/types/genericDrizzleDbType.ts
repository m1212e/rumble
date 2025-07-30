import type { DrizzleClient } from "@pothos/plugin-drizzle";

export type GenericDrizzleDbTypeConstraints = {
	query: {
		[key: string]: {
			findMany: (
				P: Partial<{
					where: any;
					columns: any;
					limit: any;
				}>,
			) => any;
			findFirst: (
				P: Partial<{
					where: any;
					columns: any;
				}>,
			) => any;
		};
	};
} & DrizzleClient;
