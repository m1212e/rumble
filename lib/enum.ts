import type { MySqlEnumColumnBuilderInitial } from "drizzle-orm/mysql-core";
import type { PgEnum } from "drizzle-orm/pg-core";
import type { SingleStoreEnumColumnBuilderInitial } from "drizzle-orm/singlestore-core";
import { RumbleError } from "../out";
import { capitalizeFirstLetter } from "./helpers/capitalize";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";

export function isRuntimeEnumSchemaType(schemaType: any): boolean {
	return Array.isArray(schemaType.enumValues);
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
> = ReturnType<
	typeof createEnumImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		SchemaBuilderType<UserContext, DB, RequestEvent, Action>
	>
>;

export const createEnumImplementer = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	SchemaBuilder extends SchemaBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
>({
	db,
	schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
	schemaBuilder: SchemaBuilder;
}) => {
	const referenceStorage = new Map<string, any>();

	const enumImplementer = <
		ExplicitEnumVariableName extends keyof EnumFields<
			NonNullable<DB["_"]["fullSchema"]>
		>,
		RefName extends string,
		EnumValues,
		EnumName extends string,
	>({
		enumVariableName,
		name,
		enumValues: enumValuesParam,
		enumName,
	}: Partial<
		{
			enumVariableName: ExplicitEnumVariableName;
			enumValues: EnumValues[];
			name: RefName | undefined;
			enumName: EnumName;
		} & (
			| { enumVariableName: ExplicitEnumVariableName }
			| { enumValues: EnumValues[] }
			| { enumName: EnumName }
		)
	>) => {
		const fullSchema = db._.fullSchema!;
		//TODO check if this can be done typesafe

		let enumSchema: any | undefined = undefined;

		if (enumVariableName) {
			enumSchema = fullSchema[enumVariableName];
		} else if (enumValuesParam) {
			enumSchema = Object.values(fullSchema)
				.filter(isRuntimeEnumSchemaType)
				.find((e: any) => e.enumValues === enumValuesParam) as any;
		} else if (enumName) {
			enumSchema = Object.values(fullSchema)
				.filter(isRuntimeEnumSchemaType)
				.find((e: any) => e.enumName === enumName) as any;
		} else {
			throw new RumbleError(
				`Could not determine enum structure! (${String(enumVariableName)}, ${enumValuesParam}, ${enumName})`,
			);
		}

		const graphqlImplementationName =
			name ?? `${capitalizeFirstLetter(enumSchema.enumName.toString())}Enum`;

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
