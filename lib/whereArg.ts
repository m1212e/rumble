import { and, eq } from "drizzle-orm";
import { capitalizeFirstLetter } from "./helpers/capitalize";
import { mapSQLTypeToTSType } from "./helpers/mapSQLTypeToTSType";
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
		SchemaBuilderType<UserContext, DB, RequestEvent, Action>
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
>({
	db,
	schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
	schemaBuilder: SchemaBuilder;
}) => {
	return <
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
		const inputType = schemaBuilder.inputType(
			name ??
				`${capitalizeFirstLetter(tableName.toString())}WhereInputArgument`,
			{
				fields: (t) => {
					const mapSQLTypeStringToInputPothosType = <
						Column extends keyof typeof schema.columns,
						SQLType extends ReturnType<
							(typeof schema.columns)[Column]["getSQLType"]
						>,
					>(
						sqlType: SQLType,
					) => {
						const gqlType = mapSQLTypeToTSType(sqlType);
						switch (gqlType) {
							case "int":
								return t.int({ required: false });
							case "string":
								return t.string({ required: false });
							case "boolean":
								return t.boolean({ required: false });
							default:
								throw new RumbleError(
									`Unknown SQL type: ${sqlType} (input). Please open an issue so it can be added.`,
								);
						}
					};
					const fields = Object.entries(schema.columns).reduce(
						(acc, [key, value]) => {
							acc[key] = mapSQLTypeStringToInputPothosType(value.getSQLType());
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
			},
		);

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
};
