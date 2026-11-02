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
const freshCopy = "../../lib/client/request.ts?live-query-requests-test";
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

type QueryCall = { context: Record<string, unknown> | undefined };

/** A client recording each query it is asked to run, answering every one with `items`. */
function recordingClient(subscription = makeSubject<any>().source) {
  const queries: QueryCall[] = [];
  const client = {
    query: (
      _query: string,
      _variables: unknown,
      context?: Record<string, unknown>,
    ) => {
      queries.push({ context });
      return fromValue({ data: { items: [{ id: "1", name: "a" }] } });
    },
    subscription: () => subscription,
  } as any;
  return { client, queries };
}

function request(client: any, enableSubscription: boolean) {
  return makeGraphQLQueryRequest({
    queryName: "items",
    schema,
    input: { id: true, name: true },
    client,
    enableSubscription,
  }) as Promise<any>;
}

describe("the requests a live query makes", () => {
  test("restarting it reads the cache, since the subscription pushes the current state", async () => {
    const { client, queries } = recordingClient();
    const result = await request(client, true);
    // the first read starts the observable
    expect(result[0].name).toBe("a");
    await tick();

    const policies = queries.map((call) => call.context?.requestPolicy);
    // the promise uses the client's own policy, the observable's restart never the network
    expect(policies).toContain(undefined);
    expect(policies).toContain("cache-first");
    expect(policies.filter((policy) => policy === undefined)).toHaveLength(1);
  });

  test("without a subscription, restarting it keeps the client's policy, its only way to refresh", async () => {
    const { client, queries } = recordingClient();
    const result = await request(client, false);
    expect(result[0].name).toBe("a");
    await tick();

    expect(queries.every((call) => call.context === undefined)).toBe(true);
  });

  test("a failed update keeps the last data rather than throwing into the transport", async () => {
    const subject = makeSubject<any>();
    const { client } = recordingClient(subject.source);
    const result = await request(client, true);
    expect(result[0].name).toBe("a");
    await tick();

    expect(() =>
      subject.next({ error: new Error("Server responded with 502") }),
    ).not.toThrow();
    await tick();
    expect(result[0].name).toBe("a");

    subject.next({ data: { items: [{ id: "1", name: "b" }] } });
    await tick();
    expect(result[0].name).toBe("b");
  });

  test("the first result's error still rejects", async () => {
    const client = {
      query: () => fromValue({ error: new Error("nope") }),
      subscription: () => makeSubject<any>().source,
    } as any;
    await expect(request(client, true)).rejects.toThrow("nope");
  });
});
