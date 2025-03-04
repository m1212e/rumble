import { EventEmitter } from "node:events";
import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import SmartSubscriptionsPlugin from "@pothos/plugin-smart-subscriptions";
import type { ContextFunctionType, ContextType } from "./context";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";

export type SchemaBuilderType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
> = ReturnType<
	typeof createSchemaBuilder<
		UserContext,
		DB,
		RequestEvent,
		Action,
		ContextFunctionType<UserContext, DB, RequestEvent, Action>
	>
>;

export const createSchemaBuilder = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	ContextFunction extends ContextFunctionType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
>({
	db,
	onlyQuery,
	subscriptions,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
	//   abilityBuilder: AbilityBuilder;
}) => {
	const builder = new SchemaBuilder<{
		Context: ContextType<UserContext, DB, RequestEvent, Action>;
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
		smartSubscriptions: subscriptions
			? {
					subscribe: subscriptions.subscribe,
					unsubscribe: subscriptions.unsubscribe,
				}
			: (() => {
					const defaultEventEmitter = new EventEmitter();

					return {
						subscribe: (name, context, cb) => {
							defaultEventEmitter.on(name, cb);
						},
						unsubscribe: (name, context) => {
							defaultEventEmitter.removeAllListeners(name);
						},
					};
				})(),
	});

	builder.queryType({});

	if (!onlyQuery) {
		builder.mutationType({});
	}

	return builder;
};
