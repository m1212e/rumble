import { is } from "drizzle-orm";
import type { MySqlAsyncDatabase } from "drizzle-orm/mysql-core";
import { MySqlTable } from "drizzle-orm/mysql-core";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import { PgTable } from "drizzle-orm/pg-core";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { DrizzleInstance } from "../types/drizzleInstanceType";

export type DBDialect = "mysql" | "postgres" | "sqlite";

const dialectCache = new WeakMap<object, DBDialect>();

export function determineDBDialectFromSchema<DB extends DrizzleInstance>(
  schema: DB["_"]["relations"],
): DBDialect {
  const cached = dialectCache.get(schema as unknown as object);
  if (cached) return cached;

  const found = new Set<DBDialect>();

  for (const table of Object.values(schema).map((t: any) => t.table)) {
    if (!table || typeof table !== "object") {
      continue;
    }

    // `is()` survives duplicate drizzle-orm copies in node_modules where
    // `instanceof` silently returns false against the "wrong" class identity.
    if (is(table, PgTable)) {
      found.add("postgres");
    } else if (is(table, MySqlTable)) {
      found.add("mysql");
    } else if (is(table, SQLiteTable)) {
      found.add("sqlite");
    }
  }

  const dialects = Array.from(found);

  if (dialects.length === 1) {
    const only = dialects[0]!;
    dialectCache.set(schema as unknown as object, only);
    return only;
  }

  if (dialects.length === 0) {
    throw new Error("No tables found in schema, could not determine dialect");
  }

  throw new Error(`Multiple dialects found in schema: ${dialects.join(", ")}`);
}

export function isPostgresDB<
  Narrowed extends PgAsyncDatabase<any, any> = PgAsyncDatabase<any, any>,
>(db: any): db is Narrowed {
  return determineDBDialectFromSchema(db._.relations) === "postgres";
}

export function isMySQLDB<
  Narrowed extends MySqlAsyncDatabase<any, any> = MySqlAsyncDatabase<any, any>,
>(db: any): db is Narrowed {
  return determineDBDialectFromSchema(db._.relations) === "mysql";
}

export function isSQLiteDB<
  Narrowed extends SQLiteAsyncDatabase<any, any, any> = SQLiteAsyncDatabase<
    any,
    any,
    any
  >,
>(db: any): db is Narrowed {
  return determineDBDialectFromSchema(db._.relations) === "sqlite";
}
