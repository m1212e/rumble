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
								return t.field({ type: "IntWhereInputArgument" });
							case "String":
								return t.field({ type: "StringWhereInputArgument" });
							case "Boolean":
								return t.boolean({ required: false });
							case "Date":
								return t.field({
									type: "DateWhereInputArgument",
								});
							case "DateTime":
								return t.field({
									type: "DateWhereInputArgument",
								});
							case "Float":
								return t.field({
									type: "FloatWhereInputArgument",
								});
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

export type NumberWhereInputArgument = {
	eq?: number;
	ne?: number;
	gt?: number;
	gte?: number;
	lt?: number;
	lte?: number;
	in?: number[];
	notIn?: number[];
	like?: string;
	ilike?: string;
	notLike?: string;
	notIlike?: string;
	isNull?: boolean;
	isNotNull?: boolean;
	arrayOverlaps?: number[];
	arrayContained?: number[];
	arrayContains?: number[];
	AND?: NumberWhereInputArgument[];
	OR?: NumberWhereInputArgument[];
	NOT?: NumberWhereInputArgument;
};

export type StringWhereInputArgument = {
	eq?: string;
	ne?: string;
	gt?: string;
	gte?: string;
	lt?: string;
	lte?: string;
	in?: string[];
	notIn?: string[];
	like?: string;
	ilike?: string;
	notLike?: string;
	notIlike?: string;
	isNull?: boolean;
	isNotNull?: boolean;
	arrayOverlaps?: string[];
	arrayContained?: string[];
	arrayContains?: string[];
	AND?: StringWhereInputArgument[];
	OR?: StringWhereInputArgument[];
	NOT?: StringWhereInputArgument;
};

export type DateWhereInputArgument = {
	eq?: Date;
	ne?: Date;
	gt?: Date;
	gte?: Date;
	lt?: Date;
	lte?: Date;
	in?: Date[];
	notIn?: Date[];
	like?: string;
	ilike?: string;
	notLike?: string;
	notIlike?: string;
	isNull?: boolean;
	isNotNull?: boolean;
	arrayOverlaps?: Date[];
	arrayContained?: Date[];
	arrayContains?: Date[];
	AND?: DateWhereInputArgument[];
	OR?: DateWhereInputArgument[];
	NOT?: DateWhereInputArgument;
};

export function implementDefaultWhereInputArgs<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
	T extends SchemaBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
>(schemaBuilder: T) {
	const IntWhereInputArgument = schemaBuilder
		.inputRef<NumberWhereInputArgument>("IntWhereInputArgument")
		.implement({
			fields: (t) => ({
				eq: t.int(),
				ne: t.int(),
				gt: t.int(),
				gte: t.int(),
				lt: t.int(),
				lte: t.int(),
				in: t.intList(),
				notIn: t.intList(),
				like: t.string(),
				ilike: t.string(),
				notLike: t.string(),
				notIlike: t.string(),
				isNull: t.boolean(),
				isNotNull: t.boolean(),
				arrayOverlaps: t.intList(),
				arrayContained: t.intList(),
				arrayContains: t.intList(),
				AND: t.field({
					type: [IntWhereInputArgument],
				}),
				OR: t.field({
					type: [IntWhereInputArgument],
				}),
				NOT: t.field({
					type: IntWhereInputArgument,
				}),
			}),
		});

	const FloatWhereInputArgument = schemaBuilder
		.inputRef<NumberWhereInputArgument>("FloatWhereInputArgument")
		.implement({
			fields: (t) => ({
				eq: t.float(),
				ne: t.float(),
				gt: t.float(),
				gte: t.float(),
				lt: t.float(),
				lte: t.float(),
				in: t.floatList(),
				notIn: t.floatList(),
				like: t.string(),
				ilike: t.string(),
				notLike: t.string(),
				notIlike: t.string(),
				isNull: t.boolean(),
				isNotNull: t.boolean(),
				arrayOverlaps: t.floatList(),
				arrayContained: t.floatList(),
				arrayContains: t.floatList(),
				AND: t.field({
					type: [FloatWhereInputArgument],
				}),
				OR: t.field({
					type: [FloatWhereInputArgument],
				}),
				NOT: t.field({
					type: FloatWhereInputArgument,
				}),
			}),
		});

	const StringWhereInputArgument = schemaBuilder
		.inputRef<StringWhereInputArgument>("StringWhereInputArgument")
		.implement({
			fields: (t) => ({
				eq: t.string(),
				ne: t.string(),
				gt: t.string(),
				gte: t.string(),
				lt: t.string(),
				lte: t.string(),
				in: t.stringList(),
				notIn: t.stringList(),
				like: t.string(),
				ilike: t.string(),
				notLike: t.string(),
				notIlike: t.string(),
				isNull: t.boolean(),
				isNotNull: t.boolean(),
				arrayOverlaps: t.stringList(),
				arrayContained: t.stringList(),
				arrayContains: t.stringList(),
				AND: t.field({
					type: [StringWhereInputArgument],
				}),
				OR: t.field({
					type: [StringWhereInputArgument],
				}),
				NOT: t.field({
					type: StringWhereInputArgument,
				}),
			}),
		});

	const DateWhereInputArgument = schemaBuilder
		.inputRef<DateWhereInputArgument>("DateWhereInputArgument")
		.implement({
			fields: (t) => ({
				eq: t.field({ type: "Date" }),
				ne: t.field({ type: "Date" }),
				gt: t.field({ type: "Date" }),
				gte: t.field({ type: "Date" }),
				lt: t.field({ type: "Date" }),
				lte: t.field({ type: "Date" }),
				in: t.field({ type: ["Date"] }),
				notIn: t.field({ type: ["Date"] }),
				like: t.string(),
				ilike: t.string(),
				notLike: t.string(),
				notIlike: t.string(),
				isNull: t.boolean(),
				isNotNull: t.boolean(),
				arrayOverlaps: t.field({ type: ["Date"] }),
				arrayContained: t.field({ type: ["Date"] }),
				arrayContains: t.field({ type: ["Date"] }),
				AND: t.field({
					type: [DateWhereInputArgument],
				}),
				OR: t.field({
					type: [DateWhereInputArgument],
				}),
				NOT: t.field({
					type: DateWhereInputArgument,
				}),
			}),
		});
}
