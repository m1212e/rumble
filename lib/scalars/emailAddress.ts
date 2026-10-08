import { GraphQLScalarType, Kind } from "graphql";
import { EmailAddressResolver as BaseEmailAddressResolver } from "graphql-scalars";
import { RumbleErrorSafe } from "../types/rumbleError";

/**
 * Validates an email address using graphql-scalars' own format check, then lowercases it, exactly
 * as the `EmailAddress` scalar does. Exported for values that do not arrive as GraphQL input,
 * such as OIDC claims.
 *
 * @throws RumbleErrorSafe if the value is not a valid email address
 */
export const normalizeEmailAddress = (value: unknown): string => {
  try {
    return (BaseEmailAddressResolver.parseValue(value) as string).toLowerCase();
  } catch (error) {
    throw new RumbleErrorSafe(
      error instanceof Error
        ? error.message
        : `Invalid email address: ${value}`,
    );
  }
};

export const EmailAddressResolver = new GraphQLScalarType<string, string>({
  name: "EmailAddress",
  description: `${BaseEmailAddressResolver.description} Lowercased.`,
  specifiedByURL: BaseEmailAddressResolver.specifiedByURL,
  serialize: normalizeEmailAddress,
  parseValue: normalizeEmailAddress,
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING) {
      throw new RumbleErrorSafe(
        `Can only validate strings as email addresses but got a: ${ast.kind}`,
      );
    }
    return normalizeEmailAddress(ast.value);
  },
});
