import type SchemaBuilder from "@pothos/core";
import { and, eq } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
import {
	type EnumImplementerType,
	isRuntimeEnumSchemaType,
	mapRuntimeEnumSchemaType,
} from "./enum";
import { capitalizeFirstLetter } from "./helpers/capitalize";
import { mapSQLTypeToGraphQLType } from "./helpers/sqlTypes/mapSQLTypeToTSType";
import type { PossibleSQLType } from "./helpers/sqlTypes/types";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type { RumbleInput } from "./types/rumbleInput";

export type ArgImplementerType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends ConstructorParameters<typeof SchemaBuilder>[0],
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

export const createArgImplementer = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends ConstructorParameters<typeof SchemaBuilder>[0],
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
		ExplicitTableName extends keyof NonNullable<DB["_"]["schema"]>,
		RefName extends string,
	>({
		tableName,
		name,
		nativeTableName,
	}: {
		tableName: ExplicitTableName;
		name?: RefName | undefined;
		nativeTableName?: string;
	}) => {
		let tableSchema = (db._.schema as NonNullable<DB["_"]["schema"]>)[
			tableName
		];
		if (nativeTableName) {
			const found: any = Object.values(db._.schema as any).find(
				(schema: any) => schema.dbName === nativeTableName,
			);
			if (found) {
				tableSchema = found;
			}
		}
		if (!tableSchema) {
			throw new RumbleError(
				`Could not find schema for ${tableName.toString()} (whereArg)`,
			);
		}
		const inputTypeName =
			name ??
			`${capitalizeFirstLetter(toCamelCase(tableName.toString()))}WhereInputArgument`;

		let ret: ReturnType<typeof implement> | undefined =
			referenceStorage.get(inputTypeName);
		if (ret) {
			return ret;
		}

		const implement = () => {
			const inputType = schemaBuilder.inputType(inputTypeName, {
				fields: (t) => {
					const mapSQLTypeStringToInputPothosType = <
						Column extends keyof typeof tableSchema.columns,
						SQLType extends ReturnType<
							(typeof tableSchema.columns)[Column]["getSQLType"]
						>,
					>(
						sqlType: SQLType,
					) => {
						const gqlType = mapSQLTypeToGraphQLType(sqlType as PossibleSQLType);
						switch (gqlType) {
							case "Int":
								return t.int({ required: false });
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
							if (isRuntimeEnumSchemaType(value)) {
								const enumVal = mapRuntimeEnumSchemaType(value);
								const enumImpl = enumImplementer({
									enumName: enumVal.enumName as any,
								});

								acc[key] = t.field({
									type: enumImpl,
									required: false,
								});
							} else {
								acc[key] = mapSQLTypeStringToInputPothosType(
									value.getSQLType(),
								);
							}

							return acc;
						},
						{} as Record<
							keyof typeof tableSchema.columns,
							ReturnType<typeof mapSQLTypeStringToInputPothosType>
						>,
					);
					//     const relations = Object.entries(schema.relations).reduce(
					//       (acc, [key, value]) => {
					//         acc[key] = t.relation(key, {
					//           query: (_args: any, ctx: any) =>
					//             ctx.abilities[tableName].filter(readAction),
					//         } as any) as any;
					//         return acc;
					//       },
					//       {} as Record<
					//         keyof typeof schema.relations,
					//         ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					//       >
					//     );
					return {
						...fields,
						// ...relations,
					};
				},
			});

			const transformArgumentToQueryCondition = <
				T extends typeof inputType.$inferInput,
			>(
				arg: T | null | undefined,
			) => {
				if (!arg) return undefined;
				const mapColumnToQueryCondition = <
					ColumnName extends keyof typeof tableSchema.columns,
				>(
					columnname: ColumnName,
				) => {
					const column = tableSchema.columns[columnname];
					const filterValue = arg[columnname];
					if (!filterValue) return;
					return eq(column, filterValue);
				};
				const conditions = Object.keys(tableSchema.columns).map(
					mapColumnToQueryCondition,
				);
				return and(...conditions);
			};

			return {
				/**
				 * The input type used to pass arguments to resolvers
				 */
				inputType,
				/**
				 * Performs a conversion of an input argument passed to a resolver to a drizzle filter.
				 * Make sure you use the correct converter for the input type.
				 */
				transformArgumentToQueryCondition,
			};
		};

		ret = implement();
		referenceStorage.set(inputTypeName, ret);
		return ret;
	};

	return argImplementer;
};
