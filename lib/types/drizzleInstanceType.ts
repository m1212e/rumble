import type { drizzle } from "drizzle-orm/node-postgres";

export type DrizzleInstance = ReturnType<typeof drizzle<Record<string, any>>>;

export type InternalDrizzleInstance<DB extends DrizzleInstance> = DB & {
	_: {
		schema: NonNullable<DB["_"]["schema"]>;
		relations: NonNullable<DB["_"]["relations"]>;
	} & Omit<DB["_"], "relations" | "schema">;
};

/**
 * Helper type to get the values of an object type as a union.
 */
type ObjectValues<T> = T[keyof T];

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
