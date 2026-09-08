import { addressValidationSchema } from "./addressValidation";

/**
 * The shape of a postal address, modeled after the OIDC `address` claim
 * (https://openid.net/specs/openid-connect-core-1_0.html#AddressClaim) and schema.org's
 * `PostalAddress`.
 */
export type AddressShape = {
  /** The street address, which may be multiple lines separated by newlines. */
  streetAddress?: string | null;
  /** City or town. */
  locality?: string | null;
  /** State, province, prefecture or region. */
  region?: string | null;
  /** Postal or zip code. */
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2 country code. */
  countryCode?: string | null;
};

/**
 * AddressInput's shape differs from AddressShape in that `countryCode` and `streetAddress` are
 * required. `countryCode`: without a country there is nothing for the validator to check
 * requiredness/format/region against, so a country-less "address" can't be verified as valid
 * for anywhere. `streetAddress`: checked against every one of the 252 countries in
 * libaddressinput's dataset — it is the one field required in literally all of them (unlike
 * e.g. city, which 13 countries including Japan and Singapore don't require, or state/zip,
 * required in barely a sixth to a third of countries) — so it's safe to require unconditionally
 * rather than only per-country. The remaining fields stay optional since their requiredness
 * genuinely varies by country; that's enforced dynamically by `addressValidationSchema` instead
 * of statically here.
 */
export type AddressInputShape = Omit<
  AddressShape,
  "countryCode" | "streetAddress"
> & {
  countryCode: string;
  streetAddress: string;
};

// TODO: Add proper type for schemaBuilder
export function implementDefaultAddressTypes(schemaBuilder: any) {
  const Address = schemaBuilder.objectRef("Address").implement({
    description:
      "A postal address, modeled after the OIDC `address` claim and schema.org's PostalAddress.",
    fields: (t: any) => ({
      streetAddress: t.exposeString("streetAddress", { nullable: true }),
      locality: t.exposeString("locality", { nullable: true }),
      region: t.exposeString("region", { nullable: true }),
      postalCode: t.exposeString("postalCode", { nullable: true }),
      countryCode: t.exposeString("countryCode", { nullable: true }),
    }),
  });

  const AddressInput = schemaBuilder.inputRef("AddressInput").implement({
    description:
      "Input counterpart of Address. countryCode and streetAddress are required — countryCode " +
      "because there is nothing to validate the other fields against without it, and " +
      "streetAddress because it's the one field required in every country. The remaining " +
      "fields are optional since their requiredness genuinely varies by country; validated as " +
      "a whole using Google's libaddressinput metadata (offline).",
    validate: addressValidationSchema,
    fields: (t: any) => ({
      streetAddress: t.string({ required: true }),
      locality: t.string({ required: false }),
      region: t.string({ required: false }),
      postalCode: t.string({ required: false }),
      countryCode: t.string({ required: true }),
    }),
  });

  return { Address, AddressInput };
}
