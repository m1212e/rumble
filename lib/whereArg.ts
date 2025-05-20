import type { Table } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
import { type EnumImplementerType, isEnumSchema } from "./enum";
import { capitalizeFirstLetter } from "./helpers/capitalize";
import { mapSQLTypeToGraphQLType } from "./helpers/sqlTypes/mapSQLTypeToTSType";
import type { PossibleSQLType } from "./helpers/sqlTypes/types";
import {
	type TableIdentifierTSName,
	tableHelper,
} from "./helpers/tableHelpers";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

export type ArgImplementerType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
	typeof createArgImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		SchemaBuilderType<UserContext, DB, RequestEvent, Action, PothosConfig>,
		EnumImplementerType<UserContext, DB, RequestEvent, Action, PothosConfig>
	>
>;

const makeDefaultName = (dbName: string) =>
	`${capitalizeFirstLetter(toCamelCase(dbName.toString()))}WhereInputArgument`;

export const createArgImplementer = <
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
	EnumImplementer extends EnumImplementerType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
>({
	db,
	schemaBuilder,
	enumImplementer,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	enumImplementer: EnumImplementer;
	schemaBuilder: SchemaBuilder;
}) => {
	const referenceStorage = new Map<string, any>();

	const argImplementer = <
		ExplicitTableName extends TableIdentifierTSName<DB>,
		RefName extends string,
	>({
		table,
		refName,
		dbName,
	}: Partial<{
		table: ExplicitTableName;
		refName: RefName | undefined;
		dbName: string;
	}> &
		(
			| {
					table: ExplicitTableName;
			  }
			| {
					dbName: string;
			  }
		)) => {
		const tableSchema = tableHelper({
			db,
			dbName,
			tsName: table!,
		});

		const inputTypeName = refName ?? makeDefaultName(tableSchema.tsName);

		let ret: ReturnType<typeof implement> | undefined =
			referenceStorage.get(inputTypeName);
		if (ret) {
			return ret;
		}

		const implement = () => {
			return schemaBuilder.inputType(inputTypeName, {
				fields: (t) => {
					const mapSQLTypeStringToInputPothosType = (
						sqlType: PossibleSQLType,
						fieldName: string,
					) => {
						const gqlType = mapSQLTypeToGraphQLType({
							sqlType,
							fieldName,
						});
						switch (gqlType) {
							case "Int":
								return t.int({ required: false });
							//TOOD: add support for non equality matching filters
							case "String":
								return t.string({ required: false });
							case "Boolean":
								return t.boolean({ required: false });
							case "Date":
								return t.field({
									type: "Date",
									required: false,
								});
							case "DateTime":
								return t.field({
									type: "DateTime",
									required: false,
								});
							case "Float":
								return t.float({ required: false });
							case "ID":
								return t.id({ required: false });
							case "JSON":
								return t.field({
									type: "JSON",
									required: false,
								});
							default:
								throw new RumbleError(
									`Unsupported argument type ${gqlType} for column ${sqlType}`,
								);
						}
					};
					const fields = Object.entries(tableSchema.columns).reduce(
						(acc, [key, value]) => {
							if (isEnumSchema(value)) {
								const enumImpl = enumImplementer({
									enumColumn: value,
								});

								acc[key] = t.field({
									type: enumImpl,
									required: false,
								});
							} else {
								acc[key] = mapSQLTypeStringToInputPothosType(
									value.getSQLType() as PossibleSQLType,
									key,
								);
							}

							return acc;
						},
						{} as Record<
							keyof typeof tableSchema.columns,
							ReturnType<typeof mapSQLTypeStringToInputPothosType>
						>,
					);

					const relations = Object.entries(tableSchema.relations ?? {}).reduce(
						(acc, [key, value]) => {
							const relationSchema = tableHelper({
								db,
								table: value.targetTable as Table,
							});
							const referenceModel = argImplementer({
								dbName: relationSchema.dbName,
							});

							acc[key] = t.field({
								type: referenceModel,
								required: false,
							});

							return acc;
						},
						{} as Record<
							keyof typeof tableSchema.columns,
							ReturnType<typeof mapSQLTypeStringToInputPothosType>
						>,
					);

					return {
						...fields,
						...relations,
					};
				},
			});
		};

		ret = implement();
		referenceStorage.set(inputTypeName, ret);
		return ret;
	};

	return argImplementer;
};
