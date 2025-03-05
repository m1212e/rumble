import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import SmartSubscriptionsPlugin, {
	subscribeOptionsFromIterator,
} from "@pothos/plugin-smart-subscriptions";
import type { createPubSub } from "graphql-yoga";
import type { ContextType } from "./context";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";

export type SchemaBuilderType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
> = ReturnType<
	typeof createSchemaBuilder<UserContext, DB, RequestEvent, Action>
>["schemaBuilder"];

export const createSchemaBuilder = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
>({
	db,
	disableDefaultObjects,
	pubsub,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
	pubsub: ReturnType<typeof createPubSub>;
}) => {
	const schemaBuilder = new SchemaBuilder<{
		Context: ContextType<UserContext, DB, RequestEvent, Action>;
		//TODO set sensible defaults here
		// Scalars: Scalars<Prisma.Decimal, Prisma.InputJsonValue | null, Prisma.InputJsonValue> & {
		// 	File: {
		// 		Input: File;
		// 		Output: never;
		// 	};
		// 	JSONObject: {
		// 		Input: any;
		// 		Output: any;
		// 	};
		// };
		DrizzleSchema: DB["_"]["fullSchema"];
	}>({
		plugins: [DrizzlePlugin, SmartSubscriptionsPlugin],
		drizzle: {
			client: db,
		},
		smartSubscriptions: {
			...subscribeOptionsFromIterator((name, context) => {
				return pubsub.subscribe(name);
			}),
		},
	});

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
