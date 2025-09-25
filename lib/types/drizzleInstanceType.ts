import type { drizzle } from "drizzle-orm/node-postgres";

export type DrizzleInstance = ReturnType<typeof drizzle>;
type InternalDrizzleDataField = DrizzleInstance["_"];

export type CheckedDrizzleInstance = Omit<DrizzleInstance, "_"> & {
	_: {
		schema: NonNullable<InternalDrizzleDataField["schema"]>;
		relations: NonNullable<InternalDrizzleDataField["relations"]>;
	} & Omit<InternalDrizzleDataField, "relations" | "schema">;
};

export type DrizzleTable<DB extends DrizzleInstance> =
	DB["_"]["schema"][keyof DB["_"]["schema"]];
