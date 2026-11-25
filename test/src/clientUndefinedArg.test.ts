import { describe, expect, test } from "bun:test";
import type { IntrospectionQuery } from "graphql";
import { buildSchema, graphql, introspectionFromSchema } from "graphql";
import { never } from "wonka";
import {
  makeGraphQLMutationRequest,
  makeGraphQLQueryRequest,
  makeGraphQLSubscriptionRequest,
} from "../../lib/client/request";

const graphqlSchema = buildSchema(/* GraphQL */ `
  scalar JSON

  input AddressInput {
    city: String
    zip: String
    nested: AddressInput
  }

  type Item {
    id: ID
    children(limit: Int, after: ID): [Item]
  }

  type Query {
    items(limit: Int, after: ID): [Item]
  }

  type Mutation {
    update(
      id: ID!
      title: String
      fileId: ID
      address: AddressInput
      addresses: [AddressInput]
      tags: [String]
      data: JSON
    ): Boolean
  }

  type Subscription {
    items(limit: Int, after: ID): [Item]
  }
`);
const schema: IntrospectionQuery = introspectionFromSchema(graphqlSchema);

type Sent = { operationString: string; variables: Record<string, any> };

/** A client recording the operations it is given, and answering them with nothing. */
function recordingClient() {
  const sent: Sent[] = [];
  const record = (operationString: string, variables: any) => {
    sent.push({ operationString, variables });
    return never;
  };
  return {
    sent,
    client: { query: record, mutation: record, subscription: record } as any,
  };
}

function sentMutation(args: Record<string, unknown>): Sent {
  const { sent, client } = recordingClient();
  makeGraphQLMutationRequest({
    mutationName: "update",
    input: { __args: args },
    client,
    schema,
  });
  return sent[0]!;
}

describe("undefined client arguments", () => {
  test("an undefined argument is left out, a null one is sent", () => {
    const { operationString, variables } = sentMutation({
      id: "1",
      title: null,
      fileId: undefined,
    });

    // strict: an undefined variable would not equal a missing one
    expect(variables).toStrictEqual({ id: "1", title: null });
    expect(operationString).not.toContain("fileId");
  });

  test("falsy values are sent", () => {
    const { variables } = sentMutation({ id: "", title: "" });
    expect(variables).toStrictEqual({ id: "", title: "" });
  });

  test("undefined fields of input objects are left out at any depth", () => {
    const { variables } = sentMutation({
      id: "1",
      address: {
        city: undefined,
        zip: null,
        nested: { city: "Kiel", zip: undefined },
      },
      addresses: [{ city: "Kiel", zip: undefined }],
    });

    expect(variables).toStrictEqual({
      id: "1",
      address: { zip: null, nested: { city: "Kiel" } },
      addresses: [{ city: "Kiel" }],
    });
  });

  test("an undefined list item stays a null, keeping the others in place", () => {
    const { variables } = sentMutation({ id: "1", tags: ["a", undefined] });
    expect(variables).toStrictEqual({ id: "1", tags: ["a", null] });
  });

  test("a JSON value goes through as it is", () => {
    const data = { a: undefined, b: null };
    expect(sentMutation({ id: "1", data }).variables.data).toBe(data);
  });

  test("only undefined arguments leave no empty parentheses, nested fields included", () => {
    const { sent, client } = recordingClient();
    const input = {
      __args: { limit: undefined, after: undefined },
      children: { __args: { limit: undefined, after: "1" }, id: true },
    };
    makeGraphQLQueryRequest({ queryName: "items", input, client, schema });
    makeGraphQLSubscriptionRequest({
      subscriptionName: "items",
      input,
      client,
      schema,
    });

    expect(sent).toHaveLength(2);
    for (const { operationString, variables } of sent) {
      expect(operationString).not.toMatch(/\(\s*\)/);
      expect(operationString).not.toContain("limit");
      expect(variables).toStrictEqual({ after: "1" });
    }
  });

  test("a resolver tells a kept argument from a cleared one", async () => {
    let received: object | undefined;
    const { operationString, variables } = sentMutation({
      id: "1",
      title: null,
      fileId: undefined,
    });
    const result = await graphql({
      schema: graphqlSchema,
      source: operationString,
      variableValues: variables,
      rootValue: {
        update: (args: object) => {
          received = { ...args };
          return true;
        },
      },
    });
    expect(result.errors).toBeUndefined();
    expect(received).toStrictEqual({ id: "1", title: null });
  });

  test("a required argument left undefined is refused by the server", async () => {
    const { operationString, variables } = sentMutation({
      id: undefined,
      title: "x",
    });
    const result = await graphql({
      schema: graphqlSchema,
      source: operationString,
      variableValues: variables,
    });
    expect(result.errors?.[0]?.message).toContain("required");
  });
});
