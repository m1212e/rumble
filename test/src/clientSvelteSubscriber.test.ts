import { describe, expect, mock, test } from "bun:test";
import type { IntrospectionQuery } from "graphql";
import { fromValue, makeSubject } from "wonka";

// Stands in for svelte's createSubscriber: the first read starts the subscription right away
// (as an effect reading the result would), and every update() call is counted.
let updates = 0;
mock.module("svelte/reactivity", () => ({
  createSubscriber: (start: (update: () => void) => () => void) => {
    let started = false;
    return () => {
      if (started) return;
      started = true;
      start(() => updates++);
    };
  },
}));

// A fresh copy: request.ts picks createSubscriber up once, when it loads, and other test files
// may have loaded it before this mock existed.
const freshCopy = "../../lib/client/request.ts?svelte-subscriber-test";
const { makeGraphQLQueryRequest }: typeof import("../../lib/client/request") =
  await import(freshCopy);

const itemType = {
  kind: "LIST",
  ofType: { kind: "OBJECT", name: "Item" },
};

const schema = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: null,
    subscriptionType: { name: "Subscription" },
    types: [
      { kind: "SCALAR", name: "ID" },
      { kind: "SCALAR", name: "String" },
      {
        kind: "OBJECT",
        name: "Item",
        fields: [
          { name: "id", args: [], type: { kind: "SCALAR", name: "ID" } },
          { name: "name", args: [], type: { kind: "SCALAR", name: "String" } },
        ],
        interfaces: [],
      },
      {
        kind: "OBJECT",
        name: "Query",
        fields: [{ name: "items", args: [], type: itemType }],
        interfaces: [],
      },
      {
        kind: "OBJECT",
        name: "Subscription",
        fields: [{ name: "items", args: [], type: itemType }],
        interfaces: [],
      },
    ],
    directives: [],
  } as any,
} as IntrospectionQuery;

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("svelte subscriber of a live query", () => {
  test("the replay on subscribing is not announced, a change is", async () => {
    const subject = makeSubject<any>();
    // like urql's cache-and-network: every (re)start of the query replays the cached result
    const client = {
      query: () => fromValue({ data: { items: [{ id: "1", name: "a" }] } }),
      subscription: () => subject.source,
    } as any;

    const result: any = await makeGraphQLQueryRequest({
      queryName: "items",
      schema,
      input: { id: true, name: true },
      client,
      enableSubscription: true,
    });
    updates = 0;

    // the first read subscribes, and is handed the data it already shows
    expect(result[0].name).toBe("a");
    await tick();
    expect(updates).toBe(0);

    subject.next({ data: { items: [{ id: "1", name: "a" }] } });
    await tick();
    expect(updates).toBe(0);

    subject.next({ data: { items: [{ id: "1", name: "b" }] } });
    await tick();
    expect(updates).toBe(1);
    expect(result[0].name).toBe("b");
  });
});
