import SchemaBuilder from "@pothos/core";
import DrizzlePlugin from "@pothos/plugin-drizzle";
import { type YogaServerOptions, createYoga } from "graphql-yoga";
import { createAbilityBuilder } from "../abilities/builder";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";

export const rumble = async <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Schema,
>({
	db,
	nativeServerOptions,
	context: makeUserContext,
}: {
	db: DB;
	nativeServerOptions?:
		| Omit<YogaServerOptions<RequestEvent, any>, "schema" | "context">
		| undefined;
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

	const nativeServer = createYoga<RequestEvent>({
		...nativeServerOptions,
		schema: nativeBuilder.toSchema(),
		context: makeContext,
	});

	return {
		abilityBuilder,
		schemaBuilder: nativeBuilder,
		server: nativeServer,
	};
};
