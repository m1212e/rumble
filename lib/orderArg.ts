import type { Table } from "drizzle-orm";
import { toCamelCase } from "drizzle-orm/casing";
import { capitalize } from "es-toolkit";
import { lazy } from "./helpers/lazy";
import {
	type TableIdentifierTSName,
	tableHelper,
} from "./helpers/tableHelpers";
import type { SchemaBuilderType } from "./schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

export type OrderArgImplementerType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
	typeof createOrderArgImplementer<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		SchemaBuilderType<UserContext, DB, RequestEvent, Action, PothosConfig>
	>
>;

const makeDefaultName = (dbName: string) =>
	`${capitalize(toCamelCase(dbName.toString()))}OrderInputArgument`;

export const createOrderArgImplementer = <
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
>({
	db,
	schemaBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	schemaBuilder: SchemaBuilder;
}) => {
	const referenceStorage = new Map<string, any>();

	const sortingParameterEnumRef = lazy(() =>
		schemaBuilder.enumType("SortingParameter", {
			values: ["asc", "desc"] as const,
		}),
	);

	const orderArgImplementer = <
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
					const fields = Object.entries(tableSchema.columns).reduce(
						(acc, [key, value]) => {
							acc[key] = t.field({
								type: sortingParameterEnumRef(),
								required: false,
							});

							return acc;
						},
						{} as Record<
							keyof typeof tableSchema.columns,
							ReturnType<typeof t.field>
						>,
					);

					const relations = Object.entries(tableSchema.relations ?? {}).reduce(
						(acc, [key, value]) => {
							const relationSchema = tableHelper({
								db,
								table: value.targetTable as Table,
							});
							const referenceModel = orderArgImplementer({
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
							ReturnType<typeof t.field>
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

	return orderArgImplementer;
};
