import type { Column, Table } from "drizzle-orm";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";

export type TableIdentifierTSName<DB extends GenericDrizzleDbTypeConstraints> =
	keyof NonNullable<DB["_"]["relations"]["schema"]>;

export function getTableSchemaByTSName<
	DB extends GenericDrizzleDbTypeConstraints,
	TSVariable extends TableIdentifierTSName<DB>,
>({ db, tsName }: { tsName: TSVariable; db: DB }) {
	return db._.relations.schema[tsName as string] as Table;
}

export function getTableSchemaByDBName<
	DB extends GenericDrizzleDbTypeConstraints,
	DBVariable extends string,
>({ db, dbName }: { dbName: DBVariable; db: DB }) {
	return Object.values(db._.relations.schema).find(
		(schema: any) => schema[Symbol.for("drizzle:Name")] === dbName,
	) as Table;
}

export function getColumnsFromSchema<T extends Table>({ table }: { table: T }) {
	return (table as any)[Symbol.for("drizzle:Columns")] as Record<
		string,
		Column
	>;
}

export function getPrimaryColumnsFromSchema<T extends Table>({
	table,
}: { table: T }) {
	const columns = getColumnsFromSchema({ table });
	return Object.values(columns).filter((v: any) => v.primary);
}

export function getDBNameByTSName<
	DB extends GenericDrizzleDbTypeConstraints,
	TSVariable extends TableIdentifierTSName<DB>,
>({ db, tsName }: { tsName: TSVariable; db: DB }) {
	return db._.relations.tablesConfig[tsName as string].dbName;
}
