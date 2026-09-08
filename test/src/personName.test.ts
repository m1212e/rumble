import { describe, expect, test } from "bun:test";
import { Kind } from "graphql";
import { PersonNameResolver } from "../../lib/scalars/personName";
import { RumbleErrorSafe } from "../../lib/types/rumbleError";

describe("PersonNameResolver", () => {
  describe("accepts", () => {
    test("a plain ASCII name", () => {
      expect(PersonNameResolver.parseValue("Jane Doe")).toBe("Jane Doe");
    });

    test("a name with an apostrophe", () => {
      expect(PersonNameResolver.parseValue("O'Brien")).toBe("O'Brien");
    });

    test("a name with a hyphen", () => {
      expect(PersonNameResolver.parseValue("Marie-Claire")).toBe(
        "Marie-Claire",
      );
    });

    test("a name with a period (initials)", () => {
      expect(PersonNameResolver.parseValue("J.R.R. Tolkien")).toBe(
        "J.R.R. Tolkien",
      );
    });

    test("names in non-Latin scripts", () => {
      expect(PersonNameResolver.parseValue("李小龙")).toBe("李小龙");
      expect(PersonNameResolver.parseValue("Владимир Путин")).toBe(
        "Владимир Путин",
      );
      expect(PersonNameResolver.parseValue("محمد")).toBe("محمد");
    });

    test("a name with combining diacritics", () => {
      // "é" written as "e" + combining acute accent (U+0301)
      const input = "José";
      expect(PersonNameResolver.parseValue(input)).toBe("José");
    });

    test("collapses internal whitespace runs to a single space", () => {
      expect(PersonNameResolver.parseValue("Jane   Doe")).toBe("Jane Doe");
    });

    test("trims leading and trailing whitespace", () => {
      expect(PersonNameResolver.parseValue("  Jane Doe  ")).toBe("Jane Doe");
    });

    test("strips invisible control/format characters", () => {
      // zero-width joiner (U+200D) in the middle of the name
      expect(PersonNameResolver.parseValue("Jane‍Doe")).toBe("JaneDoe");
    });

    test("collapses a doubled separator from a stuck key or bad paste", () => {
      expect(PersonNameResolver.parseValue("O''Donnell")).toBe("O'Donnell");
      expect(PersonNameResolver.parseValue("Marie--Claire")).toBe(
        "Marie-Claire",
      );
    });

    test("trims a stray leading or trailing separator", () => {
      expect(PersonNameResolver.parseValue("-Jane")).toBe("Jane");
      expect(PersonNameResolver.parseValue("Jane-")).toBe("Jane");
      expect(PersonNameResolver.parseValue("'Jane")).toBe("Jane");
      expect(PersonNameResolver.parseValue("- Jane -")).toBe("Jane");
    });
  });

  describe("rejects", () => {
    test("a value that is not a string", () => {
      expect(() => PersonNameResolver.parseValue(123)).toThrow(RumbleErrorSafe);
    });

    test("an empty string", () => {
      expect(() => PersonNameResolver.parseValue("")).toThrow(RumbleErrorSafe);
    });

    test("a string that is only whitespace", () => {
      expect(() => PersonNameResolver.parseValue("   ")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("a slash", () => {
      expect(() => PersonNameResolver.parseValue("Jane/Doe")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("an exclamation mark", () => {
      expect(() => PersonNameResolver.parseValue("Jane!")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("digits", () => {
      expect(() => PersonNameResolver.parseValue("Jane123")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("a comma", () => {
      expect(() => PersonNameResolver.parseValue("Doe, Jane")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("a name that is nothing but separators once trimmed", () => {
      expect(() => PersonNameResolver.parseValue("---")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("a leading/trailing period, since it's ambiguous rather than an unambiguous typo", () => {
      expect(() => PersonNameResolver.parseValue(".Jane")).toThrow(
        RumbleErrorSafe,
      );
    });

    test("a value longer than 200 characters", () => {
      expect(() => PersonNameResolver.parseValue("a".repeat(201))).toThrow(
        RumbleErrorSafe,
      );
    });
  });

  describe("serialize", () => {
    test("normalizes the same way as parseValue", () => {
      expect(PersonNameResolver.serialize("  Jane   Doe  ")).toBe("Jane Doe");
    });

    test("rejects invalid values", () => {
      expect(() => PersonNameResolver.serialize("Jane/Doe")).toThrow(
        RumbleErrorSafe,
      );
    });
  });

  describe("parseLiteral", () => {
    test("parses a valid string literal", () => {
      expect(
        PersonNameResolver.parseLiteral(
          { kind: Kind.STRING, value: "Jane Doe" } as any,
          undefined,
        ),
      ).toBe("Jane Doe");
    });

    test("rejects a non-string literal", () => {
      expect(() =>
        PersonNameResolver.parseLiteral(
          { kind: Kind.INT, value: "1" } as any,
          undefined,
        ),
      ).toThrow(RumbleErrorSafe);
    });

    test("rejects an invalid string literal", () => {
      expect(() =>
        PersonNameResolver.parseLiteral(
          { kind: Kind.STRING, value: "Jane/Doe" } as any,
          undefined,
        ),
      ).toThrow(RumbleErrorSafe);
    });
  });
});
