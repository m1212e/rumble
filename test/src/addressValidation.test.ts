import { describe, expect, test } from "bun:test";
import {
  addressData,
  addressValidationSchema,
  checkPostalCode,
  findRegionCode,
  normalizeAddress,
  validateAddress,
} from "../../lib";

const californiaAddress = {
  streetAddress: "1 Infinite Loop",
  locality: "Cupertino",
  region: "california",
  postalCode: "95014",
  countryCode: "us",
};

describe("address validation exports", () => {
  test("normalizeAddress and validateAddress work standalone", () => {
    const address = normalizeAddress(californiaAddress);

    expect(address.region).toBe("CA");
    expect(address.countryCode).toBe("US");
    expect(validateAddress(address)).toEqual([]);
  });

  test("validateAddress reports unknown countries", () => {
    const address = normalizeAddress({
      streetAddress: "somewhere",
      countryCode: "ZZ",
    });

    expect(validateAddress(address)).toEqual([
      { path: "countryCode", message: "Unknown country code: ZZ" },
    ]);
  });

  test("findRegionCode resolves names and returns undefined for unknown ones", () => {
    expect(findRegionCode({ countryCode: "US", region: "New York" })).toBe(
      "NY",
    );
    expect(
      findRegionCode({ countryCode: "US", region: "Atlantis" }),
    ).toBeUndefined();
    expect(
      findRegionCode({ countryCode: "DE", region: "Bayern" }),
    ).toBeUndefined();
  });

  test("single checks can be used on their own", () => {
    const address = normalizeAddress({ ...californiaAddress, postalCode: "X" });

    expect(
      checkPostalCode({ address, rules: addressData.US! }).map(
        (issue) => issue.path,
      ),
    ).toEqual(["postalCode"]);
  });

  test("addressValidationSchema normalizes and reports issues per field", () => {
    expect(addressValidationSchema.parse(californiaAddress).region).toBe("CA");

    const result = addressValidationSchema.safeParse({
      ...californiaAddress,
      postalCode: "X",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ["postalCode"],
    ]);
  });
});
