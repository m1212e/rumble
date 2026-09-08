import "lib-address";
import {
  AddressValidationError,
  CountryMissingError,
  InvalidStateError,
  InvalidZipError,
  isValidCountryCode,
  MissingFieldError,
  validateAddress,
} from "lib-address";
import { z } from "zod";
import type { AddressShape } from "./address";

const FIELD_PATH_MAP: Partial<Record<string, keyof AddressShape>> = {
  addressLine1: "streetAddress",
  addressLine2: "streetAddress",
  addressLine3: "streetAddress",
  city: "locality",
  dependentLocality: "locality",
  state: "region",
  zip: "postalCode",
  sortingCode: "postalCode",
};

/**
 * Fixes the unambiguous, purely-cosmetic issues (stray surrounding whitespace, wrong case)
 * before validation runs, rather than rejecting a request over them. This runs as a Zod
 * `transform`, and `@pothos/plugin-validation` uses a transform's *output* as the field's
 * actual value — so the corrected value, not the original one, is what resolvers receive.
 *
 * `countryCode` and `postalCode` are uppercased since their canonical forms always are (ISO
 * 3166-1 codes, and postal codes in every country that mixes letters and digits, e.g. GB/CA/NL).
 * `region`/`locality` are only trimmed, not case-changed: unlike country/postal codes, a region
 * is sometimes a free-text place name rather than a code (lib-address's own subdivision lookup
 * is already case-insensitive, so case coercion there wouldn't fix anything a rejection-worthy
 * case wouldn't already pass).
 */
const normalizeAddress = (address: {
  streetAddress: string;
  locality?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode: string;
}) => ({
  streetAddress:
    address.streetAddress
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n") || null,
  locality: address.locality?.trim() || null,
  region: address.region?.trim() || null,
  postalCode: address.postalCode?.trim().toUpperCase() || null,
  countryCode: address.countryCode.trim().toUpperCase(),
});

export const addressValidationSchema = z
  .object({
    // Required (not nullable/optional), like countryCode below: checked against libaddressinput
    // data for all 252 countries, streetAddress is the one field required in literally all of
    // them. A whitespace-only value still reaches the normal per-country MissingFieldError path
    // below (it normalizes to null, same as omitting it), rather than needing its own check —
    // unlike countryCode, there's no chicken-and-egg problem here (checking it doesn't first
    // require knowing which country's rules apply).
    streetAddress: z.string(),
    locality: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    // Required (not nullable/optional): without a country there is nothing to validate the
    // other fields' requiredness/format against, so a country-less "address" can't be verified.
    // Whitespace-only input is caught below, after trimming, rather than here — GraphQL's own
    // non-null check only guarantees a string was sent, not a meaningful one.
    countryCode: z.string(),
  })
  .transform(normalizeAddress)
  .superRefine((address, ctx) => {
    if (!address.countryCode) {
      ctx.addIssue({
        code: "custom",
        path: ["countryCode"],
        message: "countryCode is required.",
      });
      return;
    }

    if (!isValidCountryCode(address.countryCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["countryCode"],
        message: `Unknown country code: ${address.countryCode}`,
      });
      return;
    }

    const [addressLine1, addressLine2, addressLine3] = address.streetAddress
      ? address.streetAddress.split("\n")
      : [];

    try {
      validateAddress({
        country: address.countryCode,
        addressLine1,
        addressLine2,
        addressLine3,
        city: address.locality ?? undefined,
        // lib-address's own isValidCountrySubdivisionCode is case-insensitive, but
        // validateAddress's internal state check isn't — uppercase here (not in the value
        // returned to the client, since region is free text for some countries) to work
        // around that inconsistency rather than rejecting a validly-cased subdivision code.
        state: address.region?.toUpperCase() ?? undefined,
        zip: address.postalCode ?? undefined,
      });
    } catch (error) {
      if (error instanceof CountryMissingError) {
        ctx.addIssue({
          code: "custom",
          path: ["countryCode"],
          message: error.message,
        });
        return;
      }

      if (!(error instanceof AddressValidationError)) {
        throw error;
      }

      for (const subError of error.errors) {
        if (subError instanceof MissingFieldError) {
          const path = FIELD_PATH_MAP[subError.field];
          if (!path) {
            // e.g. "name"/"organization" — out of scope for a pure location Address.
            continue;
          }
          ctx.addIssue({
            code: "custom",
            path: [path],
            message: `${path} is required for country ${address.countryCode}.`,
          });
        } else if (subError instanceof InvalidZipError) {
          // Also matches the InvalidZipSubRegionError subclass (postal code doesn't match
          // the expected format for the given state/region within the country).
          ctx.addIssue({
            code: "custom",
            path: ["postalCode"],
            message: `Invalid postal code for country ${address.countryCode}.`,
          });
        } else if (subError instanceof InvalidStateError) {
          ctx.addIssue({
            code: "custom",
            path: ["region"],
            message: `Invalid region for country ${address.countryCode}.`,
          });
        }
      }
    }
  });
