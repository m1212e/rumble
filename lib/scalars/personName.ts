import { GraphQLScalarType, Kind } from "graphql";
import { RumbleErrorSafe } from "../types/rumbleError";

const MAX_LENGTH = 200;

const NAME_REGEX = /^[\p{L}\p{M}]+(?:(?:[ '-]|\.\x20?)[\p{L}\p{M}]+)*\.?$/u;

// smart punctuation on phones and word processors swaps these in for ' and -
const APOSTROPHE_VARIANTS = /[\u2018\u2019\u02BC\u00B4\u0060]/gu;
const HYPHEN_VARIANTS = /[\u2010-\u2015\u2212]/gu;

/**
 * Normalizes and validates a person's name, exactly as the `PersonName` scalar does. Exported
 * for values that do not arrive as GraphQL input, such as OIDC claims.
 *
 * @throws RumbleErrorSafe if the value is not a valid name
 */
export const normalizePersonName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new RumbleErrorSafe(`Name value is not a string: ${value}`);
  }

  const normalized = value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(HYPHEN_VARIANTS, "-")
    .replace(/\p{Zs}+/gu, " ")
    .trim()
    .replace(/ ?- ?/gu, "-")
    .replace(/([-'])\1+/gu, "$1")
    .replace(/^[-']+|[-']+$/gu, "")
    .trim();

  if (normalized.length === 0) {
    throw new RumbleErrorSafe("Name must not be empty.");
  }

  if (normalized.length > MAX_LENGTH) {
    throw new RumbleErrorSafe(
      `Name must not be longer than ${MAX_LENGTH} characters.`,
    );
  }

  if (!NAME_REGEX.test(normalized)) {
    throw new RumbleErrorSafe(
      `Invalid name: ${value}. Names may only contain letters and the separators space, apostrophe, hyphen and period, and may not start with or repeat a separator.`,
    );
  }

  return normalized;
};

export const PersonNameResolver = new GraphQLScalarType<string, string>({
  name: "PersonName",
  description:
    "A person's name. Unicode letters from any script are allowed, along with space, apostrophe, hyphen and period as separators between name parts. The value is Unicode NFC normalized, has invisible/control characters stripped, has its whitespace collapsed, and has unambiguous typos (typographic apostrophe or dash variants, spaces around a hyphen, a doubled or stray leading/trailing hyphen/apostrophe) silently corrected rather than rejected.",
  serialize: normalizePersonName,
  parseValue: normalizePersonName,
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING) {
      throw new RumbleErrorSafe(
        `Can only validate strings as names but got a: ${ast.kind}`,
      );
    }
    return normalizePersonName(ast.value);
  },
});
