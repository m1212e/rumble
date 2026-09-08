import { describe, expect, test } from "bun:test";
import { Kind } from "graphql";
import { EmailAddressResolver } from "../../lib/scalars/emailAddress";
import { RumbleErrorSafe } from "../../lib/types/rumbleError";

describe("EmailAddressResolver", () => {
  describe("accepts", () => {
    test("a plain email address", () => {
      expect(EmailAddressResolver.parseValue("jane@example.com")).toBe(
        "jane@example.com",
      );
    });

    test("lowercases a mixed-case address", () => {
      expect(EmailAddressResolver.parseValue("Jane.Doe@Example.COM")).toBe(
        "jane.doe@example.com",
      );
    });

    test("an address with a subdomain", () => {
      expect(EmailAddressResolver.parseValue("jane@mail.example.com")).toBe(
        "jane@mail.example.com",
      );
    });
  });

  describe("rejects", () => {
    test("a value that is not a string", () => {
      expect(() => EmailAddressResolver.parseValue(123)).toThrow(
        RumbleErrorSafe,
      );
    });

    test("a value missing an @", () => {
      expect(() => EmailAddressResolver.parseValue("jane.example.com")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("a value missing a domain", () => {
      expect(() => EmailAddressResolver.parseValue("jane@")).toThrow(
        RumbleErrorSafe,
      );
    });
  });

  describe("serialize", () => {
    test("lowercases the same way as parseValue", () => {
      expect(EmailAddressResolver.serialize("Jane@Example.com")).toBe(
        "jane@example.com",
      );
    });

    test("rejects invalid values", () => {
      expect(() => EmailAddressResolver.serialize("not-an-email")).toThrow(
        RumbleErrorSafe,
      );
    });
  });

  describe("parseLiteral", () => {
    test("parses and lowercases a valid string literal", () => {
      expect(
        EmailAddressResolver.parseLiteral(
          { kind: Kind.STRING, value: "Jane@Example.com" } as any,
          undefined,
        ),
      ).toBe("jane@example.com");
    });

    test("rejects a non-string literal", () => {
      expect(() =>
        EmailAddressResolver.parseLiteral(
          { kind: Kind.INT, value: "1" } as any,
          undefined,
        ),
      ).toThrow(RumbleErrorSafe);
    });

    test("rejects an invalid string literal", () => {
      expect(() =>
        EmailAddressResolver.parseLiteral(
          { kind: Kind.STRING, value: "not-an-email" } as any,
          undefined,
        ),
      ).toThrow(RumbleErrorSafe);
    });
  });
});
