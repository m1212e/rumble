import { describe, expect, test } from "bun:test";
import { Kind } from "graphql";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { PhoneNumberResolver } from "../../lib/scalars/phoneNumber";
import { RumbleErrorSafe } from "../../lib/types/rumbleError";

describe("PhoneNumberResolver", () => {
  describe("parseValue", () => {
    test("parses a valid E.164 number into a PhoneNumber instance", () => {
      const result = PhoneNumberResolver.parseValue("+4915123456789");
      expect(result.isValid()).toBe(true);
      expect(result.number).toBe("+4915123456789");
      expect(result.country).toBe("DE");
    });

    test("parses a valid number given with formatting characters", () => {
      const result = PhoneNumberResolver.parseValue("+49 (151) 234-56789");
      expect(result.isValid()).toBe(true);
      expect(result.number).toBe("+4915123456789");
    });

    test("rejects a value that is not a string", () => {
      expect(() => PhoneNumberResolver.parseValue(12345)).toThrow(
        RumbleErrorSafe,
      );
    });

    test("rejects a number without a country calling code", () => {
      expect(() => PhoneNumberResolver.parseValue("015123456789")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("rejects an implausible number", () => {
      expect(() => PhoneNumberResolver.parseValue("+491")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("rejects a non-numeric string", () => {
      expect(() => PhoneNumberResolver.parseValue("not a phone")).toThrow(
        RumbleErrorSafe,
      );
    });
  });

  describe("parseLiteral", () => {
    test("parses a string literal into a PhoneNumber instance", () => {
      const result = PhoneNumberResolver.parseLiteral(
        { kind: Kind.STRING, value: "+4915123456789" } as any,
        undefined,
      );
      expect((result as any).number).toBe("+4915123456789");
    });

    test("rejects a non-string literal", () => {
      expect(() =>
        PhoneNumberResolver.parseLiteral(
          { kind: Kind.INT, value: "1" } as any,
          undefined,
        ),
      ).toThrow(RumbleErrorSafe);
    });

    test("rejects an invalid string literal", () => {
      expect(() =>
        PhoneNumberResolver.parseLiteral(
          { kind: Kind.STRING, value: "not a phone" } as any,
          undefined,
        ),
      ).toThrow(RumbleErrorSafe);
    });
  });

  describe("serialize", () => {
    test("serializes a valid PhoneNumber instance to its E.164 string", () => {
      const phoneNumber = parsePhoneNumberFromString("+4915123456789");
      expect(PhoneNumberResolver.serialize(phoneNumber)).toBe("+4915123456789");
    });

    test("serializes a raw string by parsing and validating it", () => {
      expect(PhoneNumberResolver.serialize("+49 (151) 234-56789")).toBe(
        "+4915123456789",
      );
    });

    test("rejects an invalid raw string", () => {
      expect(() => PhoneNumberResolver.serialize("not a phone")).toThrow(
        RumbleErrorSafe,
      );
    });
  });
});
