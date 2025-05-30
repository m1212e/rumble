import type SchemaBuilder from "@pothos/core";
import type { createPubSub } from "graphql-yoga";
import type { GenericDrizzleDbTypeConstraints } from "./genericDrizzleDbType";

export type CustomRumblePothosConfig = Omit<
	ConstructorParameters<typeof SchemaBuilder>[0],
	"smartSubscriptions" | "drizzle"
>;

export type RumbleInput<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = {
	/**
	 * Your drizzle database instance
	 */
	db: DB;
	/**
	 * A function for providing context for each request based on the incoming HTTP Request.
	 * The type of the parameter equals the HTTPRequest type of your chosen server.
	 */
	context?:
		| ((event: RequestEvent) => Promise<UserContext> | UserContext)
		| undefined;
	/**
	 * If you only want to disable query, mutation or subscription default objects, you can do so here
	 */
	disableDefaultObjects?: {
		mutation?: boolean;
		subscription?: boolean;
		query?: boolean;
	};
	/**
	 * The actions that are available
	 */
	actions?: Action[];
	/**
	 * Customization for subscriptions. See https://the-guild.dev/graphql/yoga-server/docs/features/subscriptions#distributed-pubsub-for-production
	 */
	subscriptions?: Parameters<typeof createPubSub>;
	/**
	 * Options passed along to the pothos schema builder.
	 */
	pothosConfig?: PothosConfig;
	/**
	 * Limits the returned amount when querying lists. Set to null to disable.
	 * @default 100
	 */
	defaultLimit?: number | undefined | null;
};
