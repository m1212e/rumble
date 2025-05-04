import type { Table } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
import type { MySqlEnumColumnBuilderInitial } from "drizzle-orm/mysql-core";
import { type PgEnum, PgEnumColumn } from "drizzle-orm/pg-core";
import type { SingleStoreEnumColumnBuilderInitial } from "drizzle-orm/singlestore-core";
import { capitalizeFirstLetter } from "./helpers/capitalize";
import { getTableSchemaByTSName } from "./helpers/tableHelpers";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

/**
 * Checks if a schema type is an enum
 */
export function isRuntimeEnumSchemaType(schemaType: any): boolean {
	// TODO make this compatible with other db drivers
	return schemaType instanceof PgEnumColumn;
}

// TODO make this compatible with other db drivers
type EnumTypes = PgEnum<any>;

type EnumFields<T> = {
	[K in keyof T as T[K] extends EnumTypes ? K : never]: T[K];
};

export type EnumImplementerType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
	typeof createEnumImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		SchemaBuilderType<UserContext, DB, RequestEvent, Action, PothosConfig>
	>
>;

export const createEnumImplementer = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
	SchemaBuilder extends SchemaBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
>({
	db,
	schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	schemaBuilder: SchemaBuilder;
}) => {
	const referenceStorage = new Map<string, any>();

	const enumImplementer = <
		ExplicitEnumVariableName extends keyof EnumFields<
			NonNullable<DB["_"]["relations"]["schema"]>
		>,
		RefName extends string,
	>({
		tsName,
		refName,
	}: {
		tsName: ExplicitEnumVariableName;
		refName?: RefName | undefined;
	}) => {
		//TODO check if this can be done typesafe

		const enumSchema = getTableSchemaByTSName({
			db,
			tsName,
		});

		if (!enumSchema) {
			throw new RumbleError("Could not determine enum structure!");
		}

		const graphqlImplementationName =
			refName ?? `${capitalizeFirstLetter(toCamelCase(tsName as string))}Enum`;

		let ret: ReturnType<typeof implement> | undefined = referenceStorage.get(
			graphqlImplementationName,
		);
		if (ret) {
			return ret;
		}

		const implement = () =>
			schemaBuilder.enumType(graphqlImplementationName, {
				values: enumSchema.enumValues,
			});

		ret = implement();
		referenceStorage.set(graphqlImplementationName, ret);
		return ret;
	};

	return enumImplementer;
};
