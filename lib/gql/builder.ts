import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import { type YogaServerOptions, createYoga } from "graphql-yoga";
import { createAbilityBuilder } from "../abilities/builder";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";

export const rumble = async <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
>({
	db,
	nativeServerOptions,
	context: makeUserContext,
}: {
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
}) => {
	const abilityBuilder = createAbilityBuilder<UserContext, DB>({
		db,
	});

	const makeContext = async (req: RequestEvent) => {
		const userContext = makeUserContext
			? await makeUserContext(req)
			: ({} as UserContext);
		return {
			...userContext,
			abilities: abilityBuilder.buildWithUserContext(userContext),
		};
	};

	const nativeBuilder = new SchemaBuilder<{
		Context: Awaited<ReturnType<typeof makeContext>>;
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
		DefaultFieldNullability: false;
		DefaultArgumentNullability: false;
		DefaultInputFieldRequiredness: true;
	}>({
		plugins: [DrizzlePlugin],
		drizzle: {
			client: db,
		},
		defaultFieldNullability: false,
		defaultInputFieldRequiredness: true,
	});

	nativeBuilder.queryType({});
	nativeBuilder.mutationType({});

	const yoga = createYoga<RequestEvent>({
		...nativeServerOptions,
		schema: nativeBuilder.toSchema(),
		context: makeContext,
	});

	return {
		/**
     * The ability builder. Use it to declare whats allowed for each entity in your DB.
     * 
     * @example
     * 
     * ```ts
     * // users can edit themselves
     abilityBuilder.users
       .allow(["read", "update", "delete"])
       .when(({ userId }) => ({ where: eq(schema.users.id, userId) }));
     
     // everyone can read posts
     abilityBuilder.posts.allow("read");
     * 
     * ```
     */
		abilityBuilder,
		/**
		 * The pothos schema builder. See https://pothos-graphql.dev/docs/plugins/drizzle
		 */
		schemaBuilder: nativeBuilder,
		/**
     * The native yoga instance. Can be used to run an actual HTTP server.
     * 
     * @example
     * 
     * ```ts
      import { createServer } from "node:http";
     * const server = createServer(yoga);
     server.listen(3000, () => {
          console.log("Visit http://localhost:3000/graphql");
     });
     * ```
     */
		yoga,
	};
};
