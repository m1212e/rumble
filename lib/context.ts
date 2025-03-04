import type {
	AbilityBuilderType,
	createAbilityBuilder,
} from "./abilityBuilder";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";
import type { RumbleInput } from "./types/rumbleInput";

export type ContextFunctionType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
> = ReturnType<
	typeof createContextFunction<
		UserContext,
		DB,
		RequestEvent,
		Action,
		AbilityBuilderType<UserContext, DB, RequestEvent, Action>
	>
>;

export type ContextType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
> = Awaited<
	ReturnType<ContextFunctionType<UserContext, DB, RequestEvent, Action>>
>;

export const createContextFunction = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	AbilityBuilder extends ReturnType<
		typeof createAbilityBuilder<UserContext, DB, RequestEvent, Action>
	>,
>({
	context: makeUserContext,
	abilityBuilder,
}: RumbleInput<UserContext, DB, RequestEvent, Action> & {
	abilityBuilder: AbilityBuilder;
}) => {
	return async (req: RequestEvent) => {
		const userContext = makeUserContext
			? await makeUserContext(req)
			: ({} as UserContext);
		return {
			...userContext,
			abilities: abilityBuilder.buildWithUserContext(userContext),
		};
	};
};
