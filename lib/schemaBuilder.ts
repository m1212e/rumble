import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import type { ContextFunctionType } from "./context";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";
// import SmartSubscriptionsPlugin from "@pothos/plugin-smart-subscriptions";

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
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
	//   abilityBuilder: AbilityBuilder;
}) => {
	const builder = new SchemaBuilder<{
		Context: Awaited<ReturnType<ContextFunction>>;
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
		plugins: [
			DrizzlePlugin,
			//  SmartSubscriptionsPlugin
		],
		drizzle: {
			client: db,
		},
		// smartSubscriptions: {
		// subscribe: (
		//   name: string,
		//   context: Context,
		//   cb: (err: unknown, data?: unknown) => void,
		// ) => Promise<void> | void;
		// unsubscribe: (name: string, context: Context) => Promise<void> | void;
		// },
	});

	builder.queryType({});

	if (!onlyQuery) {
		builder.mutationType({});
	}

	return builder;
};
