import type { drizzle } from "drizzle-orm/node-postgres";
import type { ObjectValues } from "../helpers/objectFieldType";

export type DrizzleInstance = ReturnType<typeof drizzle<Record<string, any>>>;

/**
 * Type representing the schema of a Drizzle table.
 * It extracts the schema information from the internal structure of a concrete Drizzle instance.
 */
export type DrizzleTableSchema<DB extends DrizzleInstance> = ObjectValues<
  NonNullable<DB["_"]["schema"]>
>;

/**
 * Type representing the query function of a Drizzle instance.
 */
export type DrizzleQueryFunction<DB extends DrizzleInstance> = DB["query"];

/**
 * Type representing the input parameters for the `findMany` method of a specific table in the Drizzle query function.
 */
// export type DrizzleQueryFunctionInput<
//   DB extends DrizzleInstance,
//   QueryField extends keyof DrizzleQueryFunction<DB>,
// > = DrizzleQueryFunction<DB>[QueryField] extends { findMany: infer F }
//   ? F extends (...args: any[]) => any
//     ? Parameters<F>[0]
//     : never
//   : never;

export type DrizzleQueryFunctionInput<
  DB extends DrizzleInstance,
  QueryField extends keyof DrizzleQueryFunction<DB>,
> = Parameters<DrizzleQueryFunction<DB>[QueryField]["findMany"]>[0];

/**
 * Type representing the type of a record in a specific table of the Drizzle instance.
 */
export type DrizzleTableType<
  DB extends DrizzleInstance,
  QueryField extends keyof DrizzleQueryFunction<DB>,
> = NonNullable<ReturnType<DrizzleQueryFunction<DB>[QueryField]["findFirst"]>>;
