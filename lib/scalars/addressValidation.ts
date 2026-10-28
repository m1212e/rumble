import { z } from "zod";
import type { AddressShape } from "./address";
import { addressData, type CountryAddressRules } from "./addressData";

export type AddressIssue = { path: keyof AddressShape; message: string };

export type NormalizedAddress = {
  streetAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
};

/**
 * One rule an address is checked against, e.g. `checkPostalCode`. It only runs for countries
 * that have rules, and returns an empty array when the address passes.
 */
export type AddressCheck = (args: {
  address: NormalizedAddress;
  rules: CountryAddressRules;
}) => AddressIssue[];

// Only the libaddressinput field codes the Address shape has a field for. Countries can also
// require name/organization or a dependent locality (NZ), which a pure location Address can't hold.
const REQUIRED_FIELD_PATHS: Record<string, keyof AddressShape> = {
  A: "streetAddress",
  C: "locality",
  S: "region",
  Z: "postalCode",
};

/** Flags fields the country requires but the address leaves empty. */
export const checkRequiredFields: AddressCheck = ({ address, rules }) =>
  [...rules.require]
    .map((code) => REQUIRED_FIELD_PATHS[code])
    .filter((path) => path && !address[path])
    .map((path) => ({
      path: path!,
      message: `${path} is required for country ${address.countryCode}.`,
    }));

/**
 * Flags a region that isn't in the country's region list. Countries without a list accept any
 * region. Expects the region already resolved by `normalizeAddress`.
 */
export const checkRegion: AddressCheck = ({ address, rules }) => {
  if (
    !address.region ||
    !rules.regions ||
    Object.hasOwn(rules.regions, address.region)
  ) {
    return [];
  }
  return [
    {
      path: "region",
      message: `Invalid region for country ${address.countryCode}.`,
    },
  ];
};

const withExample = (message: string, example?: string) =>
  example ? `${message} Example: ${example}` : message;

/**
 * Flags a postal code that doesn't match the country's format, or doesn't belong to the given
 * region (e.g. a Washington ZIP code for California). An empty postal code passes, since
 * `checkRequiredFields` covers that.
 */
export const checkPostalCode: AddressCheck = ({ address, rules }) => {
  const { postalCode, region, countryCode } = address;
  if (!postalCode || !rules.zip) {
    return [];
  }
  if (!new RegExp(`^(?:${rules.zip})$`, "u").test(postalCode)) {
    return [
      {
        path: "postalCode",
        message: withExample(
          `Invalid postal code for country ${countryCode}.`,
          rules.zipex,
        ),
      },
    ];
  }
  const regionRules = region ? rules.regions?.[region] : undefined;
  // Region patterns are prefixes, e.g. "9[0-5]" for California
  if (
    !regionRules?.zip ||
    new RegExp(`^(?:${regionRules.zip})`, "u").test(postalCode)
  ) {
    return [];
  }
  return [
    {
      path: "postalCode",
      message: withExample(
        `Invalid postal code for region ${region} in country ${countryCode}.`,
        regionRules.zipex,
      ),
    },
  ];
};

/** The checks `validateAddress` runs, in order. */
export const addressChecks: AddressCheck[] = [
  checkRequiredFields,
  checkRegion,
  checkPostalCode,
];

// Built on first use per country, most deployments only ever see a handful of countries
const regionLookups = new Map<string, Map<string, string>>();

/**
 * Resolves a region code or any of its names, in any case, to the region code, e.g. "california"
 * to "CA" for the US. Returns undefined for unknown regions and countries without a region list.
 */
export function findRegionCode({
  countryCode,
  region,
}: {
  countryCode: string;
  region: string;
}) {
  const regions = addressData[countryCode]?.regions;
  if (!regions) {
    return undefined;
  }
  let lookup = regionLookups.get(countryCode);
  if (!lookup) {
    lookup = new Map();
    for (const [code, rules] of Object.entries(regions)) {
      for (const name of [code, ...(rules.names ?? [])]) {
        lookup.set(name.toUpperCase(), code);
      }
    }
    regionLookups.set(countryCode, lookup);
  }
  return lookup.get(region.toUpperCase());
}

/**
 * Fixes the unambiguous, purely-cosmetic issues (stray surrounding whitespace, wrong case)
 * instead of rejecting an address over them. Run it before `validateAddress`, which expects
 * its output.
 *
 * `countryCode` and `postalCode` are uppercased since their canonical forms always are (ISO
 * 3166-1 codes, and postal codes in every country that mixes letters and digits, e.g. GB/CA/NL).
 * A region that matches a known region code or name, like "california" in the US, is replaced
 * by its code. Any other region and the locality are only trimmed, since they're free text.
 */
export function normalizeAddress(address: AddressShape): NormalizedAddress {
  const countryCode = address.countryCode?.trim().toUpperCase() ?? "";
  const region = address.region?.trim() || null;
  return {
    streetAddress:
      address.streetAddress
        ?.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n") || null,
    locality: address.locality?.trim() || null,
    region: (region && findRegionCode({ countryCode, region })) || region,
    postalCode: address.postalCode?.trim().toUpperCase() || null,
    countryCode,
  };
}

/**
 * Checks a normalized address against its country's rules and returns every issue found, or an
 * empty array for a valid address.
 *
 * @example
 * ```ts
 * const issues = validateAddress(normalizeAddress(input));
 * ```
 */
export function validateAddress(address: NormalizedAddress): AddressIssue[] {
  if (!address.countryCode) {
    return [{ path: "countryCode", message: "countryCode is required." }];
  }
  const rules = Object.hasOwn(addressData, address.countryCode)
    ? addressData[address.countryCode]
    : undefined;
  if (!rules) {
    return [
      {
        path: "countryCode",
        message: `Unknown country code: ${address.countryCode}`,
      },
    ];
  }
  return addressChecks.flatMap((check) => check({ address, rules }));
}

/**
 * The schema `AddressInput` validates with. It normalizes the address, so parsing returns the
 * corrected value, and reports every issue on its field.
 */
export const addressValidationSchema = z
  .object({
    streetAddress: z.string(),
    locality: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    countryCode: z.string(),
  })
  .transform(normalizeAddress)
  .superRefine((address, ctx) => {
    for (const issue of validateAddress(address)) {
      ctx.addIssue({
        code: "custom",
        path: [issue.path],
        message: issue.message,
      });
    }
  });
