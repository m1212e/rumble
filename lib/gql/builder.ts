import SchemaBuilder from "@pothos/core";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";
import { createYoga, type YogaServerOptions } from "graphql-yoga";
import type { AbilityBuilder } from "../abilities/builder";

export const createGQLServer = async <
  UserContext extends Record<string, any>,
  DB extends GenericDrizzleDbTypeConstraints,
  AbilityBuilderT extends AbilityBuilder,
  RequestEvent extends Record<string, any>
>({
  db,
  nativeServerOptions,
  abilityBuilder,
  context: makeUserContext,
}: {
  db: DB;
  nativeServerOptions: Omit<
    YogaServerOptions<RequestEvent, any>,
    "schema" | "context"
  >;
  abilityBuilder: AbilityBuilderT;
  context: (event: RequestEvent) => Promise<UserContext> | UserContext;
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
    DefaultFieldNullability: false;
    DefaultArgumentNullability: false;
    DefaultInputFieldRequiredness: true;
  }>({
    defaultFieldNullability: false,
    defaultInputFieldRequiredness: true,
  });

  const nativeServer = createYoga<RequestEvent>({
    ...nativeServerOptions,
    schema: nativeBuilder.toSchema(),
    context: (req) => {
      const userContext = makeUserContext(req);
      return userContext;
    },
  });

  return {
    schemaBuilder: nativeBuilder,
    server: nativeServer,
  };
};
