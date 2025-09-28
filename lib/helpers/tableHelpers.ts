import type { Column } from "drizzle-orm";
import type {
  DrizzleInstance,
  DrizzleTableSchema,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";

export function tableHelper<
  DB extends DrizzleInstance,
  TableIdentifier extends
    | DrizzleTableSchema<DB>["tsName"]
    | DrizzleTableSchema<DB>["dbName"]
    | DrizzleTableSchema<DB>,
>({ db, table }: { db: DB; table: TableIdentifier }) {
  const tableSchema = (typeof table === "string"
    ? Object.values(db._.schema!).find(
        (schema) => schema.dbName === table || schema.tsName === table,
      )
    : table) as unknown as DrizzleTableSchema<DB> | undefined;

  if (!tableSchema) {
    throw new RumbleError(`Could not find schema for ${JSON.stringify(table)}`);
  }

  return {
    ...tableSchema,
    columns: tableSchema.columns as Record<string, Column>,
    // get primaryColumns() {
    // 	return Object.entries((tableSchema as any).columns)
    // 		.filter(([, v]) => (v as Column).primary)
    // 		.reduce((acc, [k, v]) => {
    // 			(acc as any)[k] = v;
    // 			return acc;
    // 		}, {}) as Record<string, Column>;
    // },
    // relations: db._.relations[tsName as string] as
    // 	| {
    // 			[key: string]: One<any, any> | Many<any, any>;
    // 	  }
    // 	| undefined,
    // dbName: (tableSchema as any).dbName as string,
    // get tsName() {
    // 	return Object.entries(db._.schema)
    // 		.find(([, v]) => v === tableSchema)!
    // 		.at(0) as string;
    // },
  };
}
