import type { createSchemaBuilder } from "../schemaBuilder";
import type { DrizzleInstance } from "./drizzleInstanceType";
import type { CustomRumblePothosConfig } from "./rumbleInput";

export type SchemaBuilderType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
  typeof createSchemaBuilder<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig
  >
>["schemaBuilder"];
