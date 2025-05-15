import type { FieldMap, SchemaTypes } from "@pothos/core";
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

//TODO this is a bit flaky, we should check if we can determine the config object more reliably
//TODO maybe a plugin can place some marker field on these objects?
const isProbablyAConfigObject = (t: any) => {
	if (typeof t !== "object") {
		return false;
	}

	if (
		Object.keys(t).some((k) =>
			[
				"args",
				"nullable",
				"query",
				"subscribe",
				"description",
				"type",
				"resolve",
			].find((e) => e === k),
		)
	)
		return true;
	return false;
};

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
		adjust,
	}: {
		/**
		 * The table you want to be used as reference for the object creation.
		 */
		table: ExplicitTableName;
		/**
		 * The name you want this object to have in your graphql schema.
		 * Rumble will create a reasonable default if not specified.
		 */
		refName?: RefName;
		/**
		 * The action used for read access to the table.
		 * Defaults to "read".
		 */
		readAction?: Action;
		/**
		 * A function which can be used to adjust the fields of the object.
		 * You can extend the object by specifying fields that do not exist as
		 * per your db schema, or overwrite existing fields with the same name.
		 * In case you do overwrite, rumble will set proper nullability and
		 * subscription properties if you do not specify them explicitly.
		 */
		adjust?:
			| ((
					t: DrizzleObjectFieldBuilder<
						SchemaBuilder["$inferSchemaTypes"],
						SchemaBuilder["$inferSchemaTypes"]["DrizzleRelationsConfig"][ExplicitTableName],
						NonNullable<
							Awaited<ReturnType<DB["query"][ExplicitTableName]["findFirst"]>>
						>
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

				// in case the user makes adjustments we want to store away which
				// pothos function was called with what config
				// this is mapped to the ref which later can be used to
				// reference these parameters while iterating over the fields
				// and checking against the userAdjustments object
				const configMap = new Map<
					any,
					{
						creatorFunction: (...p: any[]) => any;
						params: any[];
						configObject: any;
					}
				>();
				// stores the results of the user adjustments
				// also stores all the used pothos functions and the configs
				// provided by the user so we can extend that if necessary
				const userAdjustments =
					adjust?.(
						new Proxy(t, {
							get: (target, prop) => {
								if (typeof (target as any)[prop] === "function") {
									return (...params: any[]) => {
										const ref = (target as any)[prop](...params);
										const configObject = params.find(isProbablyAConfigObject);
										if (!configObject)
											throw new RumbleError(
												"Expected config object to be passed to adjust field",
											);

										configMap.set(ref, {
											params,
											creatorFunction: (target as any)[prop],
											configObject,
										});
										return ref;
									};
								}

								return (target as any)[prop];
							},
						}) as any,
					) ?? {};

				const fields = Object.entries(columns).reduce(
					(acc, [key, value]) => {
						if (userAdjustments[key]) {
							const { params, creatorFunction, configObject } = configMap.get(
								userAdjustments[key],
							)!;

							if (typeof configObject.nullable !== "boolean") {
								configObject.nullable = !value.notNull;
							}

							userAdjustments[key] = creatorFunction.bind(t)(...params);
							return acc;
						}

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
						const relationTable = makePubSubInstance({
							table: relationSchema.tsName as any,
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

						const subscribe = (subscriptions: any, element: any) => {
							relationTable.registerOnInstance({
								instance: subscriptions,
								action: "created",
							});
							relationTable.registerOnInstance({
								instance: subscriptions,
								action: "removed",
							});
						};

						if (userAdjustments[key]) {
							const { params, creatorFunction, configObject } = configMap.get(
								userAdjustments[key],
							)!;

							if (typeof configObject.nullable !== "boolean") {
								configObject.nullable = nullable;
							}

							if (typeof configObject.subscribe !== "function") {
								configObject.subscribe = subscribe;
							}

							userAdjustments[key] = creatorFunction.bind(t)(...params);
							return acc;
						}

						(acc as any)[key] = t.relation(key, {
							args: {
								where: t.arg({ type: WhereArg, required: false }),
							},
							subscribe,
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

				return {
					...fields,
					...relations,
					...userAdjustments,
				};
			},
		});
	};
};
