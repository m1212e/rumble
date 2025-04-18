import { toCamelCase } from "drizzle-orm/casing";
import type { MySqlEnumColumnBuilderInitial } from "drizzle-orm/mysql-core";
import type { PgEnum } from "drizzle-orm/pg-core";
import type { SingleStoreEnumColumnBuilderInitial } from "drizzle-orm/singlestore-core";
import { capitalizeFirstLetter } from "./helpers/capitalize";
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
	const enumSchema = mapRuntimeEnumSchemaType(schemaType);
	return (
		enumSchema.enumValues !== undefined &&
		enumSchema.enumName !== undefined &&
		typeof enumSchema.enumName === "string" &&
		Array.isArray(enumSchema.enumValues)
	);
}

/**
 * Puts an enum schema object in a uniform shape
 */
export function mapRuntimeEnumSchemaType(schemaType: any) {
	return schemaType.enum ?? schemaType;
}

type EnumTypes =
	| PgEnum<any>
	| SingleStoreEnumColumnBuilderInitial<any, any>
	| MySqlEnumColumnBuilderInitial<any, any>;

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
			NonNullable<DB["_"]["fullSchema"]>
		>,
		RefName extends string,
		// EnumValues,
		EnumName extends string,
	>({
		enumVariableName,
		name,
		// enumValues: enumValuesParam,
		enumName,
	}: Partial<
		{
			/**
			 * The name of the enum as the TS variable is defined in your schema export.
			 * @example
			 * ```ts
			 * export const committeeStatus = pgEnum('committee_status', [
			 * //	     ^^^^^^^^^^^^^^^
			 * //	 This is what you would put here ("committeeStatus")
			 *
			 *
			 * 		'FORMAL',
			 * 		'INFORMAL',
			 * 		'PAUSE',
			 * 		'SUSPENSION'
			 * 	]);
			 * ```
			 */
			enumVariableName: ExplicitEnumVariableName;
			/*
			 * The value object reference (array) that defines the enum values.
			 * Be sure to pass this by reference, the values are not checked by comparison.
			 * @example
			 * ```ts
			 *
			 * const enumValues
			 * export const committeeStatus = pgEnum('committee_status',
			 *
			 *
			 * );
			 * ```
			 */
			// enumValues: EnumValues[];

			/**
			 * The name of the enum at the database.
			 * @example
			 * ```ts
			 * export const committeeStatus = pgEnum('committee_status', [
			 * //	    			       ^^^^^^^^^^^^^^^^
			 * //	 This is what you would put here ("committee_status")
			 *
			 *
			 * 		'FORMAL',
			 * 		'INFORMAL',
			 * 		'PAUSE',
			 * 		'SUSPENSION'
			 * 	]);
			 * ```
			 */
			enumName: EnumName;
			/**
			 * The name of the about to be generated graphql enum reference.
			 */
			name: RefName | undefined;
		} & (
			| { enumVariableName: ExplicitEnumVariableName }
			// | { enumValues: EnumValues[] }
			| { enumName: EnumName }
		)
	>) => {
		const fullSchema = db._.fullSchema!;
		//TODO check if this can be done typesafe

		let enumSchema: any | undefined = undefined;

		if (enumVariableName) {
			enumSchema = fullSchema[enumVariableName];
			// } else if (enumValuesParam) {
			// 	enumSchema = Object.values(fullSchema)
			// 		.filter(isRuntimeEnumSchemaType)
			// 		.map(mapRuntimeEnumSchemaType)
			// 		.find((e: any) => e.enumValues === enumValuesParam) as any;
		} else if (enumName) {
			enumSchema = Object.values(fullSchema)
				.filter(isRuntimeEnumSchemaType)
				.map(mapRuntimeEnumSchemaType)
				.find((e: any) => e.enumName === enumName) as any;
		}

		if (!enumSchema) {
			throw new RumbleError(
				`Could not determine enum structure! (${String(enumVariableName)}, ${enumValuesParam}, ${enumName})`,
			);
		}

		const graphqlImplementationName =
			name ??
			`${capitalizeFirstLetter(toCamelCase(enumSchema.enumName.toString()))}Enum`;

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
