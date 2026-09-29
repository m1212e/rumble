import { describe, expect, test } from "bun:test";
import type { IntrospectionQuery } from "graphql";
import { fromValue } from "wonka";
import { makeGraphQLMutationRequest } from "../../lib/client/request";

// A minimal introspection schema for one mutation shaped like rumble's own
// `sendAssignmentData` (see munify-delegator's assignment.ts): a required `ID` id argument
// plus a required `JSON` scalar argument that carries an arbitrary nested payload, returning
// a plain `Boolean`.
const schema: IntrospectionQuery = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: { name: "Mutation" },
    subscriptionType: null,
    types: [
      { kind: "SCALAR", name: "ID" },
      { kind: "SCALAR", name: "JSON" },
      { kind: "SCALAR", name: "Boolean" },
      {
        kind: "INPUT_OBJECT",
        name: "WhereInput",
        inputFields: [{ name: "id", type: { kind: "SCALAR", name: "ID" } }],
      },
      {
        kind: "OBJECT",
        name: "Mutation",
        fields: [
          {
            name: "sendAssignmentData",
            args: [
              {
                name: "conferenceId",
                type: {
                  kind: "NON_NULL",
                  ofType: { kind: "SCALAR", name: "ID" },
                },
              },
              {
                name: "data",
                type: {
                  kind: "NON_NULL",
                  ofType: { kind: "SCALAR", name: "JSON" },
                },
              },
            ],
            type: { kind: "SCALAR", name: "Boolean" },
            isDeprecated: false,
          },
          {
            name: "deleteMatching",
            args: [
              {
                name: "where",
                type: { kind: "INPUT_OBJECT", name: "WhereInput" },
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

function makeFakeClient(capture: {
  operationString?: string;
  variables?: any;
}) {
  return {
    mutation: (operationString: string, variables: any) => {
      capture.operationString = operationString;
      capture.variables = variables;
      return fromValue({
        data: { [operationString.match(/\{ (\w+)/)![1]]: true },
      });
    },
  } as any;
}

describe("client JSON scalar arguments", () => {
  test("an object value for a JSON-scalar argument is sent through as-is", async () => {
    const capture: { operationString?: string; variables?: any } = {};
    const client = makeFakeClient(capture);

    // Shaped like a real assignment-assistant export: nested objects and arrays, no relation
    // to any declared INPUT_OBJECT type.
    const payload = {
      conference: { id: "c1", title: "Test Conference" },
      delegations: [{ id: "d1", members: [] }],
      singleParticipants: [],
    };

    const result = await makeGraphQLMutationRequest({
      mutationName: "sendAssignmentData",
      input: { __args: { conferenceId: "c1", data: payload } },
      client,
      schema,
    });

    expect(result).toBe(true);
    expect(capture.variables?.data).toEqual(payload);
  });

  test("an array value for a JSON-scalar argument is also sent through as-is", async () => {
    const capture: { operationString?: string; variables?: any } = {};
    const client = makeFakeClient(capture);
    const payload = [{ a: 1 }, { b: [2, 3] }];

    await makeGraphQLMutationRequest({
      mutationName: "sendAssignmentData",
      input: { __args: { conferenceId: "c1", data: payload } },
      client,
      schema,
    });

    expect(capture.variables?.data).toEqual(payload);
  });

  test("a genuine INPUT_OBJECT argument is still validated field by field", async () => {
    const capture: { operationString?: string; variables?: any } = {};
    const client = makeFakeClient(capture);

    await makeGraphQLMutationRequest({
      mutationName: "deleteMatching",
      input: { __args: { where: { id: "row-1" } } },
      client,
      schema,
    });

    expect(capture.variables?.where).toEqual({ id: "row-1" });
  });

  test("an INPUT_OBJECT argument with an unknown field still throws", () => {
    const capture: { operationString?: string; variables?: any } = {};
    const client = makeFakeClient(capture);

    // The operation (and its argument validation) is built synchronously, before the request
    // is sent, so this throws immediately rather than rejecting the returned promise.
    expect(() =>
      makeGraphQLMutationRequest({
        mutationName: "deleteMatching",
        input: { __args: { where: { nonExistentField: "x" } } },
        client,
        schema,
      }),
    ).toThrow(/nonExistentField|named based lookup/);
  });
});
