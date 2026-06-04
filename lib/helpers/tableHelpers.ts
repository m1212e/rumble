import type { Column, Many, One } from "drizzle-orm";
import type { DrizzleInstance } from "../types/drizzleInstanceType";
import { RumbleError } from "../types/rumbleError";

const drizzleNameSymbol = Symbol.for("drizzle:Name");
const drizzleOriginalNameSymbol = Symbol.for("drizzle:OriginalName");
const drizzleBaseNameSymbol = Symbol.for("drizzle:BaseName");
const drizzleColumnsSymbol = Symbol.for("drizzle:Columns");

export function tableHelper<
  DB extends DrizzleInstance,
  TableIdentifier extends
    | string
    | DB["_"]["relations"][keyof DB["_"]["relations"]],
>({ db, table }: { db: DB; table: TableIdentifier }) {
  let tableName: string;

  if (typeof table !== "string") {
    const t = table as any;
    tableName =
      t.name ??
      t[drizzleNameSymbol] ??
      t[drizzleOriginalNameSymbol] ??
      t[drizzleBaseNameSymbol];
  } else {
    tableName = table;
  }

  const foundRelation: any = Object.values(db._.relations!).find(
    (entry: any) =>
      entry.name === tableName ||
      entry.table[drizzleNameSymbol] === tableName ||
      entry.table[drizzleOriginalNameSymbol] === tableName ||
      entry.table[drizzleBaseNameSymbol] === tableName,
  );

  if (!foundRelation) {
    throw new RumbleError(
      `Could not find schema for ${JSON.stringify(tableName)}`,
    );
  }

  const tableObj = foundRelation.table;

  const columns = ((tableObj as any)[drizzleColumnsSymbol] ?? {}) as Record<
    string,
    Column
  >;

  const primaryKey = Object.fromEntries(
    Object.entries(columns).filter(([_, col]) => (col as any).primary),
  ) as Record<string, Column>;

  const dbName: string =
    (tableObj as any)[drizzleOriginalNameSymbol] ??
    (tableObj as any)[drizzleBaseNameSymbol] ??
    (tableObj as any)[drizzleNameSymbol] ??
    foundRelation.name;

  const tsName: string = foundRelation.name;

  return {
    columns,
    primaryKey,
    relations: (foundRelation as any).relations as {
      [key: string]: One<any, any> | Many<any>;
    },
    dbName,
    tsName,
    table: tableObj,
    foundRelation,
  };
}
