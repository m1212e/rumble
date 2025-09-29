import type { SchemaBuilderType } from "../schemaBuilder";
import type { InternalDrizzleInstance } from "../types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "../types/rumbleInput";
import { generateFromSchema } from "./generate/generate";

export const clientCreatorImplementer = <
  UserContext extends Record<string, any>,
  DB extends InternalDrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  SchemaBuilder extends SchemaBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >,
>({
  builtSchema,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
  builtSchema: () => ReturnType<SchemaBuilder["toSchema"]>;
}) => {
  if (process.env.NODE_ENV !== "development") {
    console.warn(
      "Running rumble client generation in non development mode. Are you sure this is correct?",
    );
  }

  const clientCreator = async ({
    apiUrl,
    outputPath,
    rumbleImportPath,
    useExternalUrqlClient,
  }: {
    /**
     * Path to the output directory where the client files will be generated.
     */
    outputPath: string;
    /**
     * The base URL of the Rumble API.
     */
    apiUrl?: string;
    /**
     * The import path for the rumble library, defaults to "@m1212e/rumble".
     */
    rumbleImportPath?: string;
    /**
     * Set this to use an external urql client exported from a module.
     * If a string, uses the provided path to the urql client for importing the client.
     * If false, creates a new urql client with the provided apiUrl.
     */
    useExternalUrqlClient?: string;
  }) => {
    const schema = builtSchema();
    await generateFromSchema({
      schema,
      outputPath,
      rumbleImportPath,
      apiUrl,
      useExternalUrqlClient,
    });
  };

  return clientCreator;
};
