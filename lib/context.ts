import type {
	AbilityBuilderType,
	createAbilityBuilder,
} from "./abilityBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "./types/rumbleInput";

export type ContextFunctionType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = ReturnType<
	typeof createContextFunction<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig,
		AbilityBuilderType<UserContext, DB, RequestEvent, Action, PothosConfig>
	>
>;

export type ContextType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
> = Awaited<
	ReturnType<
		ContextFunctionType<UserContext, DB, RequestEvent, Action, PothosConfig>
	>
>;

export const createContextFunction = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
	AbilityBuilder extends ReturnType<
		typeof createAbilityBuilder<
			UserContext,
			DB,
			RequestEvent,
			Action,
			PothosConfig
		>
	>,
>({
	context: makeUserContext,
	abilityBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	abilityBuilder: AbilityBuilder;
}) => {
	return async (req: RequestEvent) => {
		const userContext = makeUserContext
			? await makeUserContext(req)
			: ({} as UserContext);
		return {
			...userContext,
			abilities: abilityBuilder.z_buildWithUserContext(userContext),
		};
	};
};
