import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import { type YogaServerOptions, createYoga } from "graphql-yoga";
import type { AbilityBuilder } from "../abilities/builder";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";

export const createGQLServer = async <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	AbilityBuilderT extends AbilityBuilder,
	RequestEvent extends Record<string, any>,
>({
	db,
	nativeServerOptions,
	abilityBuilder,
	context: makeUserContext,
}: {
	db: DB;
	nativeServerOptions?:
		| Omit<YogaServerOptions<RequestEvent, any>, "schema" | "context">
		| undefined;
	abilityBuilder: AbilityBuilderT;
	context?:
		| ((event: RequestEvent) => Promise<UserContext> | UserContext)
		| undefined;
}) => {
	const nativeBuilder = new SchemaBuilder<{
		// Context: Awaited<ReturnType<typeof combinedContext>>;
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
		DrizzleSchema: DB["_"]["schema"];
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

	const nativeServer = createYoga<RequestEvent>({
		...nativeServerOptions,
		schema: nativeBuilder.toSchema(),
		context: (req) => {
			if (!makeUserContext) {
				return {};
			}
			const userContext = makeUserContext(req);
			return userContext;
		},
	});

	return {
		schemaBuilder: nativeBuilder,
		server: nativeServer,
	};
};
