import { describe, expect, test } from "bun:test";
import type { IntrospectionQuery } from "graphql";
import { fromValue, makeSubject } from "wonka";
import {
  makeGraphQLQueryRequest,
  makeGraphQLSubscriptionRequest,
} from "../../lib/client/request";

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

function setup(initial: any[]) {
  const subject = makeSubject<any>();
  const client = {
    query: () => fromValue({ data: { items: initial } }),
    subscription: () => subject.source,
  } as any;

  const promise: any = makeGraphQLQueryRequest({
    queryName: "items",
    schema,
    input: { id: true, name: true },
    client,
    enableSubscription: true,
  });

  const push = (items: any[]) => subject.next({ data: { items } });
  return { promise, push, subject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("client live query deduplication", () => {
  test("identical subscription data does not notify, changed data does", async () => {
    const { promise, push } = setup([{ id: "1", name: "a" }]);
    const result = await promise;

    const received: any[] = [];
    const sub = result.subscribe({
      next: (v: any) => received.push(JSON.parse(JSON.stringify(v))),
    });
    await tick();
    // initial value (query result and cached value collapse into one)
    expect(received).toEqual([[{ id: "1", name: "a" }]]);

    // exact same data as the last one (fresh object, deep equal) -> no update
    push([{ id: "1", name: "a" }]);
    push([{ id: "1", name: "a" }]);
    await tick();
    expect(received.length).toBe(1);

    // changed data -> update
    push([{ id: "1", name: "b" }]);
    await tick();
    expect(received.length).toBe(2);
    expect(received[1]).toEqual([{ id: "1", name: "b" }]);

    // identical to the new last -> no update
    push([{ id: "1", name: "b" }]);
    await tick();
    expect(received.length).toBe(2);

    // changing back is a change again
    push([{ id: "1", name: "a" }]);
    await tick();
    expect(received.length).toBe(3);

    sub.unsubscribe();
  });

  test("errors are never deduplicated", async () => {
    const { promise, subject } = setup([{ id: "1", name: "a" }]);
    const result = await promise;

    const sub = result.subscribe({ next: () => {} });
    await tick();
    // the pipeline surfaces errors by throwing; identical errors must both get through
    expect(() => subject.next({ error: new Error("boom") })).toThrow("boom");
    expect(() => subject.next({ error: new Error("boom") })).toThrow("boom");
    sub.unsubscribe();
  });

  test("plain subscriptions are deduplicated too", () => {
    const subject = makeSubject<any>();
    const client = { subscription: () => subject.source } as any;
    const received: any[] = [];
    const sub = makeGraphQLSubscriptionRequest({
      subscriptionName: "items",
      schema,
      input: { id: true, name: true },
      client,
    }).subscribe({ next: (v: any) => received.push(v) });

    const push = (name: string) =>
      subject.next({ data: { items: [{ id: "1", name }] } });
    push("a");
    push("a");
    expect(received.length).toBe(1);
    push("b");
    push("b");
    expect(received.length).toBe(2);
    push("a");
    expect(received.length).toBe(3);
    sub.unsubscribe();
  });
});
