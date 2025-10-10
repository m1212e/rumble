import type { Column, Many, One } from "drizzle-orm";
import { primaryKey } from "drizzle-orm/gel-core";
import type {
  DrizzleInstance,
  DrizzleTableSchema,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";

const drizzleNameSymbol = Symbol.for("drizzle:Name");
const drizzleOriginalNameSymbol = Symbol.for("drizzle:OriginalName");
const drizzleBaseNameSymbol = Symbol.for("drizzle:BaseName");
const drizzleColumnsSymbol = Symbol.for("drizzle:Columns");

export function tableHelper<
  DB extends DrizzleInstance,
  TableIdentifier extends
    | DrizzleTableSchema<DB>["tsName"]
    | DrizzleTableSchema<DB>["dbName"]
    | DrizzleTableSchema<DB>,
>({ db, table }: { db: DB; table: TableIdentifier }) {
  if (typeof table !== "string") {
    table =
      table.tsName ||
      table.dbName ||
      table[drizzleNameSymbol] ||
      table[drizzleOriginalNameSymbol] ||
      table[drizzleBaseNameSymbol];
  }

  const foundRelation: any = Object.values(db._.relations!).find(
    (schema: any) =>
      schema.name === table ||
      schema.table[drizzleNameSymbol] === table ||
      schema.table[drizzleOriginalNameSymbol] === table ||
      schema.table[drizzleBaseNameSymbol] === table,
  );

  if (!foundRelation) {
    throw new RumbleError(`Could not find schema for ${JSON.stringify(table)}`);
  }

  const foundSchema = Object.values(db._.schema!).find(
    (schema) =>
      schema.dbName === foundRelation.table[drizzleOriginalNameSymbol],
  );

  if (!foundSchema) {
    throw new RumbleError(`Could not find schema for ${JSON.stringify(table)}`);
  }

  return {
    columns: foundSchema.columns as Record<string, Column>,
    primaryKey: foundSchema.primaryKey,
    relations: (foundRelation as any).relations as {
      [key: string]: One<any, any> | Many<any>;
    },
    dbName: foundSchema.dbName,
    tsName: foundSchema.tsName,
    foundSchema,
    foundRelation,
  };
}
