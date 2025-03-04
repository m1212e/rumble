import type { YogaServerOptions } from "graphql-yoga";
import type { GenericDrizzleDbTypeConstraints } from "./genericDrizzleDbType";

export type RumbleInput<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
> = {
	/**
	 * Your drizzle database instance
	 */
	db: DB;
	/**
	 * Optional options for the native GraphQL Yoga server
	 */
	nativeServerOptions?:
		| Omit<YogaServerOptions<RequestEvent, any>, "schema" | "context">
		| undefined;
	/**
	 * A function for providing context for each request based on the incoming HTTP Request.
	 * The type of the parameter equals the HTTPRequest type of your chosen server.
	 */
	context?:
		| ((event: RequestEvent) => Promise<UserContext> | UserContext)
		| undefined;
	/**
	 * If you only want to create queries and do not need mutations, enable this
	 */
	onlyQuery?: boolean;
	/**
	 * The actions that are available
	 */
	actions?: Action[];
};
