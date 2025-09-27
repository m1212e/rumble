import type { drizzle } from "drizzle-orm/node-postgres";
import type { ObjectValues } from "../helpers/objectFieldType";

export type DrizzleInstance = ReturnType<typeof drizzle<Record<string, any>>>;

export type InternalDrizzleInstance<DB extends DrizzleInstance> = DB & {
	_: {
		schema: NonNullable<DB["_"]["schema"]>;
		relations: NonNullable<DB["_"]["relations"]>;
	} & Omit<DB["_"], "relations" | "schema">;
	// query: {
	// 	// [K in keyof DB["query"]]: NonNullable<DB["query"][K]>;
	// 	findMany: NonNullable<DB["query"]["findMany"]>;
	// 	findFirst: NonNullable<DB["query"]["findFirst"]>;
	// };
};

/**
 * Type representing the schema of a Drizzle table.
 * It extracts the schema information from the internal structure of a concrete Drizzle instance.
 */
export type DrizzleTableSchema<DB extends DrizzleInstance> = ObjectValues<
	InternalDrizzleInstance<DB>["_"]["schema"]
>;

/**
 * Type representing the query function of a Drizzle instance.
 */
export type DrizzleQueryFunction<DB extends DrizzleInstance> =
	InternalDrizzleInstance<DB>["query"];

/**
 * Type representing the input parameters for the `findMany` method of a specific table in the Drizzle query function.
 */
export type DrizzleQueryFunctionInput<
	DB extends DrizzleInstance,
	QueryField extends keyof DrizzleQueryFunction<DB>,
> = DrizzleQueryFunction<DB>[QueryField] extends { findMany: infer F }
	? F extends (...args: any[]) => any
		? Parameters<F>[0]
		: never
	: never;

/**
 * Type representing the return type of the `findMany` method of a specific table in the Drizzle query function.
 */
export type DrizzleQueryFunctionReturnType<
	DB extends DrizzleInstance,
	QueryField extends keyof DrizzleQueryFunction<DB>,
> = DrizzleQueryFunction<DB>[QueryField] extends { findFirst: infer F }
	? F extends (...args: any[]) => any
		? ReturnType<F>
		: never
	: never;
