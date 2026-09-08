import { GraphQLScalarType, Kind } from "graphql";
import {
  type PhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { RumbleErrorSafe } from "../types/rumbleError";

/**
 * Parses and validates a phone number using libphonenumber-js (Google's phone number metadata),
 * which checks real per-country validity (length, area code plausibility, ...) rather than just
 * the E.164 shape.
 */
const parse = (value: unknown): PhoneNumber => {
  if (typeof value !== "string") {
    throw new RumbleErrorSafe(`Phone number value is not a string: ${value}`);
  }

  const phoneNumber = parsePhoneNumberFromString(value);
  if (!phoneNumber?.isValid()) {
    throw new RumbleErrorSafe(
      `Invalid phone number: ${value}. Please provide a valid phone number including its country calling code, e.g. +4915123456789.`,
    );
  }

  return phoneNumber;
};

/**
 * Resolvers may either return an already-parsed PhoneNumber (e.g. one obtained via `parse`
 * above) or a raw string, which is parsed and validated the same way input values are.
 */
const serialize = (value: unknown): string => {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as PhoneNumber).isValid === "function"
  ) {
    const phoneNumber = value as PhoneNumber;
    if (!phoneNumber.isValid()) {
      throw new RumbleErrorSafe(`Invalid phone number: ${phoneNumber.number}`);
    }
    return phoneNumber.number;
  }

  return parse(value).number;
};

export const PhoneNumberResolver = new GraphQLScalarType<PhoneNumber, string>({
  name: "PhoneNumber",
  description:
    "A phone number, validated using real per-country validity rules and represented as a parsed libphonenumber-js PhoneNumber. On the wire it is transported as the E.164 format (https://en.wikipedia.org/wiki/E.164), e.g. +4915123456789. The country calling code is required.",
  serialize,
  parseValue: parse,
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING) {
      throw new RumbleErrorSafe(
        `Can only validate strings as phone numbers but got a: ${ast.kind}`,
      );
    }
    return parse(ast.value);
  },
});
