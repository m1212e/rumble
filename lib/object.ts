import { mapSQLTypeToGraphQLType } from "./helpers/sqlTypes/mapSQLTypeToTSType";
import type { PossibleSQLType } from "./helpers/sqlTypes/types";
import { type MakePubSubInstanceType, createPubSubInstance } from "./pubsub";
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
	MakePubSubInstance extends MakePubSubInstanceType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
>({
	db,
	schemaBuilder,
	makePubSubInstance,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
	schemaBuilder: SchemaBuilder;
	makePubSubInstance: MakePubSubInstance;
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
		const primaryKey = schema.primaryKey.at(0)?.name;
		if (!primaryKey)
			console.warn(
				`Could not find primary key for ${tableName.toString()}. Cannot register subscriptions!`,
			);

		const { registerOnInstance } = makePubSubInstance({ tableName });

		return schemaBuilder.drizzleObject(tableName, {
			name,
			subscribe: (subscriptions, element, context) => {
				if (!primaryKey) return;
				const primaryKeyValue = (element as any)[primaryKey];
				if (!primaryKeyValue) {
					console.warn(
						`Could not find primary key value for ${JSON.stringify(
							element,
						)}. Cannot register subscription!`,
					);
					return;
				}

				registerOnInstance({
					instance: subscriptions,
					action: "updated",
					primaryKeyValue: primaryKeyValue,
				});
			},
			fields: (t) => {
				const mapSQLTypeStringToExposedPothosType = <
					Column extends keyof typeof schema.columns,
					SQLType extends ReturnType<
						(typeof schema.columns)[Column]["getSQLType"]
					>,
				>(
					sqlType: SQLType,
					columnName: Column,
					nullable: boolean,
				) => {
					const gqlType = mapSQLTypeToGraphQLType(sqlType as PossibleSQLType);
					switch (gqlType) {
						case "Int":
							// @ts-expect-error
							return t.exposeInt(columnName, { nullable });
						case "String":
							// @ts-expect-error
							return t.exposeString(columnName, { nullable });
						case "Boolean":
							// @ts-expect-error
							return t.exposeBoolean(columnName, { nullable });
						case "Date":
							return t.field({
								type: "Date",
								resolve: (element) => (element as any)[columnName] as Date,
								nullable,
							});
						case "DateTime":
							return t.field({
								type: "DateTime",
								resolve: (element) => (element as any)[columnName] as Date,
								nullable,
							});
						case "Float":
							// @ts-expect-error
							return t.exposeFloat(columnName, { nullable });
						case "ID":
							// @ts-expect-error
							return t.exposeID(columnName, { nullable });
						case "JSON":
							return t.field({
								type: "JSON",
								resolve: (element) => (element as any)[columnName] as unknown,
								nullable,
							});
						default:
							throw new RumbleError(
								`Unsupported object type ${gqlType} for column ${columnName}`,
							);
					}
				};

				const fields = Object.entries(schema.columns).reduce(
					(acc, [key, value]) => {
						value.notNull;
						acc[key] = mapSQLTypeStringToExposedPothosType(
							value.getSQLType(),
							key,
							!value.notNull,
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
							query: (_args: any, ctx: any) => {
								return ctx.abilities[value.referencedTableName].filter(
									readAction,
								);
							},
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
