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

  return tableSchema as Omit<typeof tableSchema, "columns"> & {
    columns: Record<string, Column>;
  };
}
