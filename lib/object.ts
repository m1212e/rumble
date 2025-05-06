import type { FieldMap } from "@pothos/core";
import type { DrizzleObjectFieldBuilder } from "@pothos/plugin-drizzle";
import { One, type Table } from "drizzle-orm";
import type { AbilityBuilderType } from "./abilityBuilder";
import { type EnumImplementerType, isEnumSchema } from "./enum";
import { capitalizeFirstLetter } from "./helpers/capitalize";
import { mapSQLTypeToGraphQLType } from "./helpers/sqlTypes/mapSQLTypeToTSType";
import type { PossibleSQLType } from "./helpers/sqlTypes/types";
import {
	type TableIdentifierTSName,
	tableHelper,
} from "./helpers/tableHelpers";
import type { MakePubSubInstanceType } from "./pubsub";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import { RumbleError } from "./types/rumbleError";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";
import type { ArgImplementerType } from "./whereArg";

export const createObjectImplementer = <
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
	ArgImplementer extends ArgImplementerType<
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
	MakePubSubInstance extends MakePubSubInstanceType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
	AbilityBuilderInstance extends AbilityBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
>({
	db,
	schemaBuilder,
	makePubSubInstance,
	argImplementer,
	enumImplementer,
	abilityBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	schemaBuilder: SchemaBuilder;
	argImplementer: ArgImplementer;
	enumImplementer: EnumImplementer;
	makePubSubInstance: MakePubSubInstance;
	abilityBuilder: AbilityBuilderInstance;
}) => {
	return <
		ExplicitTableName extends TableIdentifierTSName<DB>,
		RefName extends string,
	>({
		table,
		refName,
		readAction = "read" as Action,
		extend,
	}: {
		table: ExplicitTableName;
		refName?: RefName;
		readAction?: Action;
		extend?:
			| ((
					t: DrizzleObjectFieldBuilder<
						SchemaBuilder["$inferSchemaTypes"],
						any,
						any,
						any
					>,
			  ) => FieldMap)
			| undefined;
	}) => {
		const tableSchema = tableHelper({ db, tsName: table });
		if (Object.keys(tableSchema.primaryColumns).length === 0) {
			console.warn(
				`Could not find primary key for ${table.toString()}. Cannot register subscriptions!`,
			);
		}
		const primaryKey = Object.values(tableSchema.primaryColumns)[0];

		const { registerOnInstance } = makePubSubInstance({ table: table });

		return schemaBuilder.drizzleObject(table, {
			name: refName ?? capitalizeFirstLetter(table.toString()),
			subscribe: (subscriptions, element, context) => {
				if (!primaryKey) return;
				const primaryKeyValue = (element as any)[primaryKey.name];
				if (!primaryKeyValue) {
					console.warn(
						`Could not find primary key value for ${JSON.stringify(
							element,
						)}. Cannot register subscription!`,
					);
					return;
				}

				//TODO maybe register non specific update calls aswell?
				registerOnInstance({
					instance: subscriptions,
					action: "updated",
					primaryKeyValue: primaryKeyValue,
				});
			},
			applyFilters:
				abilityBuilder?.registeredFilters?.[table as any]?.[readAction],
			fields: (t) => {
				const columns = tableSchema.columns;
				const mapSQLTypeStringToExposedPothosType = <
					Column extends keyof typeof columns,
					SQLType extends ReturnType<(typeof columns)[Column]["getSQLType"]>,
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

				const fields = Object.entries(columns).reduce(
					(acc, [key, value]) => {
						if (isEnumSchema(value)) {
							const enumImpl = enumImplementer({
								enumColumn: value,
							});

							acc[key] = t.field({
								type: enumImpl,
								resolve: (element) => (element as any)[key],
								nullable: !value.notNull,
							});
						} else {
							acc[key] = mapSQLTypeStringToExposedPothosType(
								value.getSQLType(),
								key,
								!value.notNull,
							);
						}
						return acc;
					},
					{} as Record<
						keyof typeof columns,
						ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					>,
				);

				const relations = Object.entries(tableSchema.relations ?? {}).reduce(
					(acc, [key, value]) => {
						const relationSchema = tableHelper({
							db,
							table: value.targetTable as Table,
						});
						const WhereArg = argImplementer({
							dbName: relationSchema.dbName,
						});

						// many relations will return an empty array so we just don't set them nullable
						let nullable = false;
						let isMany = true;
						let filterSpecifier = "many";
						if (value instanceof One) {
							isMany = false;
							nullable = value.optional;
							filterSpecifier = "single";
						}

						(acc as any)[key] = t.relation(key, {
							args: {
								where: t.arg({ type: WhereArg, required: false }),
							},
							nullable,
							query: (args: any, ctx: any) => {
								return ctx.abilities[relationSchema.tsName].filter(readAction, {
									inject: { where: args.where },
								}).query[filterSpecifier];
							},
						} as any) as any;
						return acc;
					},
					{} as Record<
						keyof typeof tableSchema.relations,
						ReturnType<typeof mapSQLTypeStringToExposedPothosType>
					>,
				);

				return extend
					? {
							...fields,
							...relations,
							...(extend(t as any) ?? {}),
						}
					: {
							...fields,
							...relations,
						};
			},
		});
	};
};
