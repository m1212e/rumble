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

function request(
  client: any,
  enableSubscription: boolean,
  onError?: (error: any) => void,
) {
  return makeGraphQLQueryRequest({
    queryName: "items",
    schema,
    input: { id: true, name: true },
    client,
    enableSubscription,
    onError,
  }) as Promise<any>;
}

/** A client whose queries answer only when told to, recording how many it was asked to run. */
function pendingClient() {
  const answers = makeSubject<any>();
  let queries = 0;
  const client = {
    query: () => {
      queries++;
      return answers.source;
    },
    subscription: () => makeSubject<any>().source,
  } as any;
  return { client, answer: answers.next, queries: () => queries };
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

  test("subscribing before the first result joins its query rather than asking again", async () => {
    // without a cache exchange, a second query would go to the network
    const { client, answer, queries } = pendingClient();
    const result = request(client, true);
    const seen: string[] = [];
    (result as any).subscribe((items: any) => seen.push(items?.[0]?.name));
    await tick();
    answer({ data: { items: [{ id: "1", name: "a" }] } });
    expect((await result)[0].name).toBe("a");
    await tick();

    expect(queries()).toBe(1);
    expect(seen).toContain("a");
  });

  test("subscribe answers the unsubscribe function, which also carries it as unsubscribe", async () => {
    const subject = makeSubject<any>();
    const { client } = recordingClient(subject.source);
    const result = await request(client, true);
    const seen: string[] = [];
    const unsubscribe = result.subscribe((items: any) =>
      seen.push(items?.[0]?.name),
    );
    expect(typeof unsubscribe).toBe("function");
    expect(unsubscribe.unsubscribe).toBe(unsubscribe);

    // an update replaces the data underneath; the result keeps its subscribe
    subject.next({ data: { items: [{ id: "1", name: "c" }] } });
    await tick();
    expect(result[0].name).toBe("c");
    expect(typeof result.subscribe).toBe("function");

    unsubscribe();
    subject.next({ data: { items: [{ id: "1", name: "b" }] } });
    await tick();
    expect(seen).not.toContain("b");
  });

  test("a failed update reaches onError", async () => {
    const subject = makeSubject<any>();
    const { client } = recordingClient(subject.source);
    const errors: unknown[] = [];
    const result = await request(client, true, (error) => errors.push(error));
    result.subscribe(() => {});
    await tick();

    const failure = new Error("Server responded with 502");
    subject.next({ error: failure });
    await tick();
    expect(errors).toEqual([failure]);
    expect(result[0].name).toBe("a");
  });
});
