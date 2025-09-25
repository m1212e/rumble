import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import SmartSubscriptionsPlugin, {
	subscribeOptionsFromIterator,
} from "@pothos/plugin-smart-subscriptions";
import {
	DateResolver,
	DateTimeISOResolver,
	JSONResolver,
} from "graphql-scalars";
import type { createPubSub } from "graphql-yoga";
import type { ContextType } from "./context";
import ExplicitChecksPlugin from "./runtimeFiltersPlugin/runtimeFiltersPlugin";
import type { InternalDrizzleInstance } from "./types/drizzleInstanceType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";
import {
	type DateWhereInputArgument,
	implementDefaultWhereInputArgs,
	type NumberWhereInputArgument,
	type StringWhereInputArgument,
} from "./whereArg";

export type SchemaBuilderType<
	UserContext extends Record<string, any>,
	DB extends InternalDrizzleInstance,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
	typeof createSchemaBuilder<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>
>["schemaBuilder"];

export const createSchemaBuilder = <
	UserContext extends Record<string, any>,
	DB extends InternalDrizzleInstance,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
>({
	db,
	disableDefaultObjects,
	pubsub,
	pothosConfig,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	pubsub: ReturnType<typeof createPubSub>;
}) => {
	const schemaBuilder = new SchemaBuilder<{
		Context: ContextType<UserContext, DB, RequestEvent, Action, PothosConfig>;
		DrizzleRelations: DB["_"]["relations"];
		Scalars: {
			JSON: {
				Input: unknown;
				Output: unknown;
			};
			Date: {
				Input: Date;
				Output: Date;
			};
			DateTime: {
				Input: Date;
				Output: Date;
			};
		};
		Inputs: {
			IntWhereInputArgument: NumberWhereInputArgument;
			FloatWhereInputArgument: NumberWhereInputArgument;
			StringWhereInputArgument: StringWhereInputArgument;
			DateWhereInputArgument: DateWhereInputArgument;
		};
	}>({
		...pothosConfig,
		plugins: [
			ExplicitChecksPlugin,
			DrizzlePlugin,
			SmartSubscriptionsPlugin,
			...(pothosConfig?.plugins ?? []),
		],
		drizzle: {
			client: db,
			relations: db._.relations,
			getTableConfig(table) {
				//TODO support composite primary keys
				return {
					columns: Object.values((table as any)[Symbol.for("drizzle:Columns")]),
					primaryKeys: Object.values(
						(table as any)[Symbol.for("drizzle:Columns")],
					).filter((v: any) => v.primary),
				} as any;
			},
		},
		smartSubscriptions: {
			...subscribeOptionsFromIterator((name, _context) => {
				return pubsub.subscribe(name);
			}),
		},
	});

	schemaBuilder.addScalarType("JSON", JSONResolver);
	schemaBuilder.addScalarType("Date", DateResolver);
	schemaBuilder.addScalarType("DateTime", DateTimeISOResolver);
	implementDefaultWhereInputArgs(schemaBuilder as any);

	if (!disableDefaultObjects?.query) {
		schemaBuilder.queryType({});
	}

	if (!disableDefaultObjects?.subscription) {
		schemaBuilder.subscriptionType({});
	}

	if (!disableDefaultObjects?.mutation) {
		schemaBuilder.mutationType({});
	}

	return { schemaBuilder };
};
