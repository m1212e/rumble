import { and, eq } from "drizzle-orm";
import { type EnumImplementerType, isRuntimeEnumSchemaType } from "./enum";
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
> = ReturnType<
	typeof createArgImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		SchemaBuilderType<UserContext, DB, RequestEvent, Action>,
		EnumImplementerType<UserContext, DB, RequestEvent, Action>
	>
>;

export const createArgImplementer = <
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
	EnumImplementer extends EnumImplementerType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
>({
	db,
	schemaBuilder,
	enumImplementer,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
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
	}: {
		tableName: ExplicitTableName;
		name?: RefName | undefined;
	}) => {
		const schema = (db._.schema as NonNullable<DB["_"]["schema"]>)[tableName];
		const inputTypeName =
			name ??
			`${capitalizeFirstLetter(tableName.toString())}WhereInputArgument`;

		let ret: ReturnType<typeof implement> | undefined =
			referenceStorage.get(inputTypeName);
		if (ret) {
			return ret;
		}

		const implement = () => {
			const inputType = schemaBuilder.inputType(inputTypeName, {
				fields: (t) => {
					const mapSQLTypeStringToInputPothosType = <
						Column extends keyof typeof schema.columns,
						SQLType extends ReturnType<
							(typeof schema.columns)[Column]["getSQLType"]
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
					const fields = Object.entries(schema.columns).reduce(
						(acc, [key, value]) => {
							if (isRuntimeEnumSchemaType(value)) {
								const enumImpl = enumImplementer({
									enumName: value.name as any,
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
							keyof typeof schema.columns,
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
					ColumnName extends keyof typeof schema.columns,
				>(
					columnname: ColumnName,
				) => {
					const column = schema.columns[columnname];
					const filterValue = arg[columnname];
					if (!filterValue) return;
					return eq(column, filterValue);
				};
				const conditions = Object.keys(schema.columns).map(
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
