import { describe, expect, test } from "bun:test";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { parse } from "graphql";
import { rumble } from "../../lib";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";

function makeAddressTestInstance(
  db: any,
  userId: string,
  options: { validation?: Parameters<typeof rumble>[0]["validation"] } = {},
) {
  const r = rumble({
    db,
    schema,
    defaultLimit: null,
    context() {
      return { userId };
    },
    validation: options.validation,
  });

  r.schemaBuilder.queryFields((t) => ({
    ping: t.field({
      type: "String",
      resolve: () => "pong",
    }),
  }));

  r.schemaBuilder.mutationFields((t) => ({
    submitAddress: t.field({
      type: "Address",
      args: {
        address: t.arg({ type: "AddressInput", required: true }),
      },
      resolve: (_root, args) => args.address,
    }),
  }));

  const yogaInstance = r.createYoga();
  const executor = buildHTTPExecutor({
    fetch: yogaInstance.fetch,
    endpoint: "http://yoga/graphql",
  });
  return { executor };
}

const SUBMIT_ADDRESS = /* GraphQL */ `
  mutation SubmitAddress($address: AddressInput!) {
    submitAddress(address: $address) {
      streetAddress
      locality
      region
      postalCode
      countryCode
    }
  }
`;

describe("Address / AddressInput", () => {
  test("accepts a valid, complete address for a country", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "Invalidenstraße 116",
          locality: "Berlin",
          postalCode: "10115",
          countryCode: "DE",
        },
      },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data.submitAddress).toEqual({
      streetAddress: "Invalidenstraße 116",
      locality: "Berlin",
      region: null,
      postalCode: "10115",
      countryCode: "DE",
    });
  });

  test("normalizes case and stray whitespace instead of rejecting", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "  1 Infinite Loop  \n\n  ",
          locality: "  Cupertino  ",
          region: "  ca  ",
          postalCode: "  95014  ",
          countryCode: " us ",
        },
      },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data.submitAddress).toEqual({
      streetAddress: "1 Infinite Loop",
      locality: "Cupertino",
      region: "CA",
      postalCode: "95014",
      countryCode: "US",
    });
  });

  test("rejects an address missing countryCode at the GraphQL level", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "somewhere",
        },
      },
    });

    // GraphQL's own input-coercion rejects this before our validator ever runs, since
    // countryCode is a required (non-null) field on AddressInput — the exact wording is
    // graphql-js's, not ours, so just assert the request was rejected.
    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.length).toBeGreaterThan(0);
  });

  test("rejects a whitespace-only countryCode", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "somewhere",
          countryCode: "   ",
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(/countryCode is required/i);
  });

  test("rejects an address missing streetAddress at the GraphQL level", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          countryCode: "DE",
        },
      },
    });

    // GraphQL's own input-coercion rejects this, since streetAddress is a required
    // (non-null) field on AddressInput — see the countryCode-missing test above.
    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.length).toBeGreaterThan(0);
  });

  test("rejects a whitespace-only streetAddress", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "   ",
          locality: "Berlin",
          postalCode: "10115",
          countryCode: "DE",
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(/streetAddress is required/i);
  });

  test("rejects a missing required field for the given country", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "Invalidenstraße 116",
          locality: "Berlin",
          countryCode: "DE",
          // missing postalCode, required for DE
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(/postalCode/i);
  });

  test("uses a custom validationError formatter when configured", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id, {
      validation: {
        validationError: (failure) =>
          `custom-format:${failure.issues.map((i) => i.path?.join(".")).join(",")}`,
      },
    });

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "Invalidenstraße 116",
          locality: "Berlin",
          countryCode: "DE",
          // missing postalCode, required for DE
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toBe("custom-format:address.postalCode");
  });

  test("rejects a postal code that doesn't match the country's format", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "Invalidenstraße 116",
          locality: "Berlin",
          postalCode: "ABCDE",
          countryCode: "DE",
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(
      /Invalid postal code for country DE\. Example: \d{5}/,
    );
  });

  test("rejects a postal code that doesn't match the given US state", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "1 Infinite Loop",
          locality: "Cupertino",
          region: "CA",
          postalCode: "98014", // valid US zip, but not a California one
          countryCode: "US",
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(
      /Invalid postal code for region CA in country US\. Example: \d{5}/,
    );
  });

  test("rejects an invalid region for the given country", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "1 Infinite Loop",
          locality: "Cupertino",
          region: "ZZ",
          postalCode: "95014",
          countryCode: "US",
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(/region/i);
  });

  test("accepts a missing postal code where the country doesn't require one", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          // IE has a postal code format, but doesn't require one
          streetAddress: "1 Main Street",
          locality: "Dublin",
          countryCode: "IE",
        },
      },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.submitAddress.countryCode).toBe("IE");
  });

  test("accepts any region where the country requires one but has no region list", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "1 Main Street",
          locality: "Charlotte Amalie",
          region: "St. Thomas",
          postalCode: "00802",
          countryCode: "VI",
        },
      },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.submitAddress.region).toBe("St. Thomas");
  });

  test("resolves a region name to its code", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "1 Infinite Loop",
          locality: "Cupertino",
          region: "california",
          postalCode: "95014",
          countryCode: "US",
        },
      },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.submitAddress.region).toBe("CA");
  });

  test("resolves a Latin region name in a country with non-Latin region names", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "1-1 Chiyoda",
          region: "Tokyo",
          postalCode: "100-0001",
          countryCode: "JP",
        },
      },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.submitAddress.region).toBe("13");
  });

  test("rejects an unknown region where the region is optional but listed", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "1 Main Street",
          locality: "Dublin",
          region: "Atlantis",
          countryCode: "IE",
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(/region/i);
  });

  test("rejects an unknown country code", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { executor } = makeAddressTestInstance(db, data.users[0].id);

    const res: any = await executor({
      document: parse(SUBMIT_ADDRESS),
      variables: {
        address: {
          streetAddress: "somewhere",
          countryCode: "ZZ",
        },
      },
    });

    expect(res.data?.submitAddress).toBeUndefined();
    expect(res.errors?.[0]?.message).toMatch(/country/i);
  });
});
