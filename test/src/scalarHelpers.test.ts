import { describe, expect, test } from "bun:test";
import {
  normalizeEmailAddress,
  normalizePersonName,
  parsePhoneNumber,
  RumbleErrorSafe,
} from "../../lib";

describe("exported scalar helpers", () => {
  test("normalizePersonName normalizes like the PersonName scalar", () => {
    expect(normalizePersonName("  Anne‐Marie   O’Neil ")).toBe(
      "Anne-Marie O'Neil",
    );
    expect(() => normalizePersonName("")).toThrow(RumbleErrorSafe);
  });

  test("normalizeEmailAddress lowercases like the EmailAddress scalar", () => {
    expect(normalizeEmailAddress("Jane.Doe@Example.COM")).toBe(
      "jane.doe@example.com",
    );
    expect(() => normalizeEmailAddress("not an email")).toThrow(
      RumbleErrorSafe,
    );
  });

  test("parsePhoneNumber yields the E.164 form", () => {
    expect(parsePhoneNumber("+49 151 23456789").number).toBe("+4915123456789");
    expect(() => parsePhoneNumber("12")).toThrow(RumbleErrorSafe);
  });
});
