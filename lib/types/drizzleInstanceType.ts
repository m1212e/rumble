import type { MySqlDatabase } from "drizzle-orm/mysql-core";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { ObjectValues } from "./objectFieldType";

export type DrizzleInstance =
  | PgAsyncDatabase<any, any>
  | BaseSQLiteDatabase<any, any, any, any>
  | MySqlDatabase<any, any>;

/**
 * Type representing the relational config of a table in a Drizzle instance.
 * In rc3+, schema info lives in db._.relations (TablesRelationalConfig) rather than db._.schema.
 */
export type DrizzleTableSchema<DB extends DrizzleInstance> = ObjectValues<
  DB["_"]["relations"]
>;

/**
 * Type representing the query function of a Drizzle instance.
 */
export type DrizzleQueryFunction<DB extends DrizzleInstance> = DB["query"];

/**
 * Type representing the input parameters for the `findMany` method of a specific table in the Drizzle query function.
 */
export type DrizzleQueryFunctionInput<
  DB extends DrizzleInstance,
  QueryField extends keyof DrizzleQueryFunction<DB>,
> = Parameters<DrizzleQueryFunction<DB>[QueryField]["findMany"]>[0];

/**
 * Type representing the type of a record in a specific table of the Drizzle instance.
 */
export type DrizzleTableValueType<
  DB extends DrizzleInstance,
  QueryField extends keyof DrizzleQueryFunction<DB>,
> = NonNullable<
  Awaited<ReturnType<DrizzleQueryFunction<DB>[QueryField]["findFirst"]>>
>;
