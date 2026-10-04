import { describe, expect, test } from "bun:test";
import type { IntrospectionQuery } from "graphql";
import { fromValue } from "wonka";
import { makeGraphQLMutationRequest } from "../../lib/client/request";

const nonNull = (ofType: any) => ({ kind: "NON_NULL", ofType });

// a mutation taking a date directly and a list of dates
const schema: IntrospectionQuery = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: { name: "Mutation" },
    subscriptionType: null,
    types: [
      { kind: "SCALAR", name: "DateTime" },
      { kind: "SCALAR", name: "Boolean" },
      {
        kind: "OBJECT",
        name: "Mutation",
        fields: [
          {
            name: "markDays",
            args: [
              {
                name: "day",
                type: nonNull({ kind: "SCALAR", name: "DateTime" }),
              },
              {
                name: "days",
                type: nonNull({
                  kind: "LIST",
                  ofType: nonNull({ kind: "SCALAR", name: "DateTime" }),
                }),
              },
            ],
            type: { kind: "SCALAR", name: "Boolean" },
            isDeprecated: false,
          },
        ],
        interfaces: [],
      },
    ],
    directives: [],
  } as any,
};

describe("client date arguments", () => {
  const send = async (args: Record<string, unknown>) => {
    const capture: { variables?: any } = {};
    const client = {
      mutation: (_operationString: string, variables: any) => {
        capture.variables = variables;
        return fromValue({ data: { markDays: true } });
      },
    } as any;

    await makeGraphQLMutationRequest({
      mutationName: "markDays",
      input: { __args: args },
      client,
      schema,
    });
    return capture.variables;
  };

  const date = new Date("2026-10-04T12:00:00.000Z");

  test("a date argument is serialized", async () => {
    const variables = await send({ day: date, days: [] });
    expect(variables.day).toEqual(date.toISOString());
  });

  test("dates inside a list argument are serialized", async () => {
    const variables = await send({ day: date, days: [date] });
    expect(variables.days).toEqual([date.toISOString()]);
  });
});
