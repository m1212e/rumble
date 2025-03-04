import { and, eq } from "drizzle-orm";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type { RumbleInput } from "./types/rumbleInput";

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
				`${
					String(tableName).charAt(0).toUpperCase() + String(tableName).slice(1)
				}WhereInputArgument`,
			{
				fields: (t) => {
					const mapSQLTypeStringToInputPothosType = <
						Column extends keyof typeof schema.columns,
						SQLType extends ReturnType<
							(typeof schema.columns)[Column]["getSQLType"]
						>,
					>(
						sqlType: SQLType,
						columnName: Column,
					) => {
						switch (sqlType) {
							case "serial":
								// @ts-expect-error
								return t.field(columnName, { required: false });
							case "int":
								// @ts-expect-error
								return t.int(columnName, { required: false });
							case "string":
								// @ts-expect-error
								return t.string(columnName, { required: false });
							case "text":
								// @ts-expect-error
								return t.string(columnName, { required: false });
							case "boolean":
								// @ts-expect-error
								return t.boolean(columnName, { required: false });
							default:
								throw new RumbleError(
									`Unknown SQL type: ${sqlType} (input). Please open an issue so it can be added.`,
								);
						}
					};
					const fields = Object.entries(schema.columns).reduce(
						(acc, [key, value]) => {
							acc[key] = mapSQLTypeStringToInputPothosType(
								value.getSQLType(),
								key,
							);
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
		return { inputType, transformArgumentToQueryCondition };
	};
};
