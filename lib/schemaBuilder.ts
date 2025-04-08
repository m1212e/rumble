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
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

export type SchemaBuilderType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
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
	DB extends GenericDrizzleDbTypeConstraints,
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
		DrizzleSchema: DB["_"]["fullSchema"];
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
	}>({
		plugins: [
			DrizzlePlugin,
			SmartSubscriptionsPlugin,
			...(pothosConfig?.plugins ?? []),
		],
		...pothosConfig,
		drizzle: {
			client: db,
		},
		smartSubscriptions: {
			...subscribeOptionsFromIterator((name, context) => {
				return pubsub.subscribe(name);
			}),
		},
	});

	schemaBuilder.addScalarType("JSON", JSONResolver);
	schemaBuilder.addScalarType("Date", DateResolver);
	schemaBuilder.addScalarType("DateTime", DateTimeISOResolver);

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
