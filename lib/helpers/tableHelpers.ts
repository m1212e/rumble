import type { Column } from "drizzle-orm";
import type {
  DrizzleInstance,
  DrizzleTableSchema,
} from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";

const drizzleNameSymbol = Symbol.for("drizzle:Name");
const drizzleOriginalNameSymbol = Symbol.for("drizzle:OriginalName");
const drizzleBaseNameSymbol = Symbol.for("drizzle:BaseName");

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

  foundSchema.relations = foundRelation.relations;

  return foundSchema as unknown as Omit<typeof foundSchema, "columns"> & {
    columns: Record<string, Column>;
  };
}
