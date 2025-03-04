import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type { RumbleInput } from "./types/rumbleInput";

export const createObjectImplementer = <
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
		readAction = "read" as Action,
	}: {
		tableName: ExplicitTableName;
		name: RefName;
		readAction?: Action;
	}) => {
		const schema = (db._.schema as NonNullable<DB["_"]["schema"]>)[tableName];

		return schemaBuilder.drizzleObject(tableName, {
			name,
			fields: (t) => {
				const mapSQLTypeStringToExposedPothosType = <
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
							return t.exposeInt(columnName);
						case "int":
							// @ts-expect-error
							return t.exposeInt(columnName);
						case "string":
							// @ts-expect-error
							return t.exposeString(columnName);
						case "text":
							// @ts-expect-error
							return t.exposeString(columnName);
						case "boolean":
							// @ts-expect-error
							return t.exposeBoolean(columnName);
						default:
							throw new RumbleError(
								`Unknown SQL type: ${sqlType}. Please open an issue so it can be added.`,
							);
					}
				};

				const fields = Object.entries(schema.columns).reduce(
					(acc, [key, value]) => {
						acc[key] = mapSQLTypeStringToExposedPothosType(
							value.getSQLType(),
							key,
						);
						return acc;
					},
					{} as Record<
						keyof typeof schema.columns,
						ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					>,
				);

				const relations = Object.entries(schema.relations).reduce(
					(acc, [key, value]) => {
						acc[key] = t.relation(key, {
							query: (_args: any, ctx: any) =>
								ctx.abilities[key].filter(readAction),
						} as any) as any;
						return acc;
					},
					{} as Record<
						keyof typeof schema.relations,
						ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					>,
				);

				return {
					...fields,
					...relations,
				};
			},
		});
	};
};
