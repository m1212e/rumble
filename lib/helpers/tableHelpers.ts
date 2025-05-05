import type { Column, Many, One, Table } from "drizzle-orm";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";
import { RumbleError } from "../types/rumbleError";

export type TableIdentifierTSName<DB extends GenericDrizzleDbTypeConstraints> =
	keyof NonNullable<DB["_"]["relations"]["schema"]>;

const nameSymbol = Symbol.for("drizzle:Name");
const columnsSymbol = Symbol.for("drizzle:Columns");

export function tableHelper<
	DB extends GenericDrizzleDbTypeConstraints,
	TSVariable extends TableIdentifierTSName<DB>,
	DBVariable extends string,
	T extends Table,
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
	let tableSchema: Table | undefined = table;

	if (tsName) {
		tableSchema = db._.relations.schema[tsName as string];
	}

	if (dbName) {
		tableSchema = Object.values(db._.relations.schema).find(
			(schema: any) => schema[nameSymbol] === dbName,
		);
	}

	if (!tableSchema) {
		console.log({ tsName, dbName, table });

		throw new RumbleError(
			`Could not find schema for ${JSON.stringify({ tsName, dbName, table: (table as any)?.[nameSymbol] }).toString()}`,
		);
	}

	return {
		columns: (tableSchema as any)[columnsSymbol] as Record<string, Column>,
		get primaryColumns() {
			return Object.entries((tableSchema as any)[columnsSymbol])
				.filter(([k, v]) => v.primary)
				.reduce((acc, [k, v]) => {
					(acc as any)[k] = v;
					return acc;
				}, {}) as Record<string, Column>;
		},
		relations: db._.relations.config[tsName as string] as {
			[key: string]: One<any, any> | Many<any, any>;
		},
		dbName: (tableSchema as any)[nameSymbol] as string,
		get tsName() {
			return Object.entries(db._.relations.schema)
				.find(([key, v]) => v === tableSchema)!
				.at(0) as string;
		},
	};
}
