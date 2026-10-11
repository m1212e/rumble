import { describe, expect, test } from "bun:test";
import type { IntrospectionQuery } from "graphql";
import { fromValue } from "wonka";
import { makeGraphQLQueryRequest } from "../../lib/client/request";

const named = (name: string) => ({ kind: "SCALAR", name });
const object = (name: string) => ({ kind: "OBJECT", name });

const schema = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: null,
    subscriptionType: null,
    types: [
      named("ID"),
      named("String"),
      {
        kind: "OBJECT",
        name: "Item",
        fields: [
          { name: "id", args: [], type: named("ID") },
          { name: "tag", args: [], type: object("Tag") },
        ],
        interfaces: [],
      },
      {
        // a result object without an identity
        kind: "OBJECT",
        name: "Tag",
        fields: [{ name: "label", args: [], type: named("String") }],
        interfaces: [],
      },
      {
        kind: "OBJECT",
        name: "Owner",
        fields: [
          { name: "id", args: [], type: named("ID") },
          {
            name: "items",
            args: [],
            type: { kind: "LIST", ofType: object("Item") },
          },
        ],
        interfaces: [],
      },
      {
        kind: "OBJECT",
        name: "Query",
        fields: [{ name: "owner", args: [], type: object("Owner") }],
        interfaces: [],
      },
    ],
    directives: [],
  } as any,
} as IntrospectionQuery;

function operationOf(input: Record<string, any>) {
  let operation = "";
  const client = {
    query: (document: string) => {
      operation = document;
      return fromValue({ data: { owner: { id: "1", items: [] } } });
    },
  } as any;
  makeGraphQLQueryRequest({
    queryName: "owner",
    schema,
    input,
    client,
    autoIncludeIdField: "id",
  });
  return operation.replace(/\s+/g, " ");
}

describe("client autoIncludeIdField", () => {
  test("is added to nested selections too", () => {
    expect(operationOf({ items: { tag: { label: true } } })).toContain(
      "owner { id items { id tag {",
    );
  });

  test("is only added to types that have the field", () => {
    const operation = operationOf({ items: { tag: { label: true } } });
    expect(operation).toContain("tag { label }");
  });

  test("does not write into the caller's selection", () => {
    const input = { items: { tag: { label: true } } };
    operationOf(input);
    expect(input).toEqual({ items: { tag: { label: true } } });
  });
});
