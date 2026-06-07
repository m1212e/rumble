import type { AbilityBuilderType } from "./abilityBuilder";
import { lazy } from "./helpers/lazy";
import type { DrizzleInstance } from "./types/drizzleInstanceType";
import type {
  CustomRumblePothosConfig,
  RumbleInput,
} from "./types/rumbleInput";

export type ContextFunctionType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  Schema extends Record<string, any>,
> = ReturnType<
  typeof createContextFunction<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    Schema
  >
>;

export type ContextType<
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  Schema extends Record<string, any>,
> = Awaited<
  ReturnType<
    ContextFunctionType<
      UserContext,
      DB,
      RequestEvent,
      Action,
      PothosConfig,
      Schema
    >
  >
>;

export const createContextFunction = <
  UserContext extends Record<string, any>,
  DB extends DrizzleInstance,
  RequestEvent extends Record<string, any>,
  Action extends string,
  PothosConfig extends CustomRumblePothosConfig,
  Schema extends Record<string, any>,
>({
  context: makeUserContext,
  abilityBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig, Schema> & {
  abilityBuilder: AbilityBuilderType<
    UserContext,
    DB,
    RequestEvent,
    Action,
    PothosConfig,
    Schema
  >;
}) => {
  const builtAbilityBuilder = lazy(() => abilityBuilder._.build());

  return async (req: RequestEvent) => {
    const userContext = makeUserContext
      ? await makeUserContext(req)
      : ({} as UserContext);

    return {
      ...userContext,
      abilities: builtAbilityBuilder()(userContext),
    };
  };
};
