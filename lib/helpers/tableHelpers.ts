import type { Column, Many, One } from "drizzle-orm";
import type { NonEnumFields } from "../enum";
import type {
	CheckedDrizzleInstance,
	DrizzleTable,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";

export function tableHelper<
	DB extends CheckedDrizzleInstance,
	TSVariable extends keyof DrizzleTable<DB>,
	DBVariable extends DrizzleTable<DB>,
	T extends DrizzleTable<DB>,
>({
	dbName,
	tsName,
	table,
	db,
}: Partial<{
	tsName: TSVariable;
	dbName: DBVariable;
	table: T;
}> &
	(
		| {
				dbName: DBVariable;
		  }
		| {
				tsName: TSVariable;
		  }
		| {
				table: T;
		  }
	) & { db: DB }) {
	let tableSchema = table;

	if (tsName) {
		tableSchema = db._.schema[tsName];
	}

	if (dbName) {
		tableSchema = Object.values(db._.schema).find(
			(schema: any) => schema.dbName === dbName,
		);
	}

	if (!tableSchema) {
		throw new RumbleError(
			`Could not find schema for ${JSON.stringify({ tsName, dbName, table: (table as any)?.dbName }).toString()}`,
		);
	}

	return {
		tableSchema,
		columns: tableSchema.columns as Record<string, Column>,
		get primaryColumns() {
			return Object.entries((tableSchema as any).columns)
				.filter(([, v]) => (v as Column).primary)
				.reduce((acc, [k, v]) => {
					(acc as any)[k] = v;
					return acc;
				}, {}) as Record<string, Column>;
		},
		relations: db._.relations.config[tsName as string] as
			| {
					[key: string]: One<any, any> | Many<any, any>;
			  }
			| undefined,
		dbName: (tableSchema as any).dbName as string,
		get tsName() {
			return Object.entries(db._.schema)
				.find(([, v]) => v === tableSchema)!
				.at(0) as string;
		},
	};
}
