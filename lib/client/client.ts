import type { DrizzleInstance } from "../types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "../types/rumbleInput";
import type { SchemaBuilderType } from "../types/schemaBuilderType";
import { generateFromSchema } from "./generate/generate";

export const clientCreatorImplementer = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
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
  const clientCreator = async ({
    apiUrl,
    outputPath,
    rumbleImportPath,
    useExternalUrqlClient,
    removeExisting,
    forceReactivity,
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
    /**
     * Whether to remove existing generated files in the output directory before generating new ones.
     */
    removeExisting?: boolean;
    /**
     * Whether to force reactivity for generated queries and mutations. This will prevent the actual response fields of the awaited response from being populated
     * and requires you to subscribe to the response to access the data. Useful to prevent forgetting to subscribe to the response to utilize reactive data.
     */
    forceReactivity?: boolean;
  }) => {
    if (process.env.NODE_ENV !== "development") {
      console.warn(
        "Running rumble client generation in non development mode. Are you sure this is correct?",
      );
    }
    const schema = builtSchema();
    await generateFromSchema({
      schema,
      outputPath,
      rumbleImportPath,
      apiUrl,
      useExternalUrqlClient,
      removeExisting,
      forceReactivity,
    });
  };

  return clientCreator;
};
