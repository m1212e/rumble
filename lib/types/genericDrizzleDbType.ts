import type { DrizzleClient } from "@pothos/plugin-drizzle";
import type { MySqlDatabase } from "drizzle-orm/mysql-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { SingleStoreDatabase } from "drizzle-orm/singlestore-core";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

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
	execute?:
		| PgDatabase<any, any>["execute"]
		| MySqlDatabase<any, any>["execute"]
		| SingleStoreDatabase<any, any>["execute"]
		| undefined;

	run?: BaseSQLiteDatabase<any, any>["run"];
} & DrizzleClient;
