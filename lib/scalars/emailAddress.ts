import { GraphQLScalarType, Kind } from "graphql";
import { EmailAddressResolver as BaseEmailAddressResolver } from "graphql-scalars";
import { RumbleErrorSafe } from "../types/rumbleError";

/**
 * Validates an email address using graphql-scalars' own format check, then lowercases it.
 */
const normalize = (value: unknown): string => {
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
  serialize: normalize,
  parseValue: normalize,
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING) {
      throw new RumbleErrorSafe(
        `Can only validate strings as email addresses but got a: ${ast.kind}`,
      );
    }
    return normalize(ast.value);
  },
});
