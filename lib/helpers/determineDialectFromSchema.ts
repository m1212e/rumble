import type { MySqlDatabase } from "drizzle-orm/mysql-core";
import { MySqlTable } from "drizzle-orm/mysql-core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { PgTable } from "drizzle-orm/pg-core";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { DrizzleInstance } from "../types/drizzleInstanceType";

export type DBDialect = "mysql" | "postgres" | "sqlite";

export function determineDBDialectFromSchema<DB extends DrizzleInstance>(
  schema: DB["_"]["relations"],
) {
  const found = new Set<DBDialect>();

  for (const table of Object.values(schema).map((t: any) => t.table)) {
    if (typeof table !== "object") {
      continue;
    }

    if (table instanceof PgTable) {
      found.add("postgres");
    } else if (table instanceof MySqlTable) {
      found.add("mysql");
    } else if (table instanceof SQLiteTable) {
      found.add("sqlite");
    }
  }

  const dialects = Array.from(found);

  if (dialects.length === 1) {
    return dialects[0];
  }

  if (dialects.length === 0) {
    throw new Error("No tables found in schema, could not determine dialect");
  }

  throw new Error(`Multiple dialects found in schema: ${dialects.join(", ")}`);
}

export function isPostgresDB<
  Narrowed extends PgDatabase<any, any> = PgDatabase<any, any>,
>(db: any): db is Narrowed {
  const dialect = determineDBDialectFromSchema(db._.relations);

  return dialect === "postgres";
}

export function isMySQLDB<
  Narrowed extends MySqlDatabase<any, any> = MySqlDatabase<any, any>,
>(db: any): db is Narrowed {
  const dialect = determineDBDialectFromSchema(db._.relations);

  return dialect === "mysql";
}

export function isSQLiteDB<
  Narrowed extends BaseSQLiteDatabase<any, any> = BaseSQLiteDatabase<any, any>,
>(db: any): db is Narrowed {
  const dialect = determineDBDialectFromSchema(db._.relations);

  return dialect === "sqlite";
}
