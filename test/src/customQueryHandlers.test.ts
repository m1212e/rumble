import { beforeEach, describe, expect, mock, test } from "bun:test";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { parse } from "graphql";
import { rumble } from "../../lib";
import type { DB } from "./db/db";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";

function makeInstanceWithCustomHandlers(
  db: DB,
  userId: string,
  overrides: {
    findMany?: (p: any) => any;
    findFirst?: (p: any) => any;
  } = {},
) {
  const r = rumble({
    db,
    schema,
    defaultLimit: null,
    context() {
      return { userId };
    },
  });

  r.object({ table: "users" });
  r.query({ table: "users" });

  r.object({ table: "comments" });
  r.query({ table: "comments" });

  r.object({ refName: "Post", table: "posts" });
  r.query({
    table: "posts",
    findMany: overrides.findMany,
    findFirst: overrides.findFirst,
  });

  return {
    rumble: r,
    build: () => {
      const yogaInstance = r.createYoga();
      const executor = buildHTTPExecutor({
        fetch: yogaInstance.fetch,
        endpoint: "http://yoga/graphql",
      });
      return { executor, yogaInstance };
    },
  };
}

describe("custom findMany/findFirst query handlers", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;
  });

  test("custom findMany is used instead of the default db lookup", async () => {
    const fakePosts = [
      { id: "fake-1", title: "Fake title", text: "Fake text", ownerId: null },
    ];
    const findMany = mock(async () => fakePosts);

    const { rumble: r, build } = makeInstanceWithCustomHandlers(
      db,
      data.users[0].id,
      { findMany },
    );
    r.abilityBuilder.posts.allow(["read"]);

    const { executor } = build();
    const res = await executor({
      document: parse(/* GraphQL */ `
        query {
          posts {
            id
            title
            text
          }
        }
      `),
    });

    expect(findMany).toHaveBeenCalled();
    expect((res as any).data.posts).toEqual([
      { id: "fake-1", title: "Fake title", text: "Fake text" },
    ]);
  });

  test("custom findMany receives tx, filter and queryArgs", async () => {
    let received: any;
    const findMany = mock(async (p: any) => {
      received = p;
      return [];
    });

    const { rumble: r, build } = makeInstanceWithCustomHandlers(
      db,
      data.users[0].id,
      { findMany },
    );
    r.abilityBuilder.posts.allow(["read"]);

    const { executor } = build();
    await executor({
      document: parse(/* GraphQL */ `
        query {
          posts {
            id
          }
        }
      `),
    });

    expect(findMany).toHaveBeenCalled();
    // tx defaults to the plain db handle when no search transaction is involved
    expect(received.tx).toBe(db);
    // filter is the merged ability/where/order/limit filter passed into query()
    expect(received.filter).toHaveProperty("where");
    // queryArgs is the pothos-selected drizzle query config (has the selected columns)
    expect(received.queryArgs).toHaveProperty("columns");
  });

  test("default findMany behavior is unaffected when no override is given", async () => {
    const { rumble: r, build } = makeInstanceWithCustomHandlers(
      db,
      data.users[0].id,
    );
    r.abilityBuilder.posts.allow(["read"]);

    const { executor } = build();
    const res = await executor({
      document: parse(/* GraphQL */ `
        query {
          posts {
            id
          }
        }
      `),
    });

    expect((res as any).data.posts.length).toEqual(data.posts.length);
  });

  test("custom findFirst is used instead of the default db lookup", async () => {
    const fakePost = {
      id: data.posts[0].id,
      title: "Overridden title",
      text: "Overridden text",
      ownerId: null,
    };
    const findFirst = mock(async () => fakePost);

    const { rumble: r, build } = makeInstanceWithCustomHandlers(
      db,
      data.users[0].id,
      { findFirst },
    );
    r.abilityBuilder.posts.allow(["read"]);

    const { executor } = build();
    const res = await executor({
      document: parse(/* GraphQL */ `
        query {
          post(id: "${data.posts[0].id}") {
            id
            title
            text
          }
        }
      `),
    });

    expect(findFirst).toHaveBeenCalled();
    expect((res as any).data.post).toEqual({
      id: fakePost.id,
      title: "Overridden title",
      text: "Overridden text",
    });
  });

  test("custom findFirst receives tx, filter and queryArgs", async () => {
    let received: any;
    const findFirst = mock(async (p: any) => {
      received = p;
      return { ...data.posts[0] };
    });

    const { rumble: r, build } = makeInstanceWithCustomHandlers(
      db,
      data.users[0].id,
      { findFirst },
    );
    r.abilityBuilder.posts.allow(["read"]);

    const { executor } = build();
    await executor({
      document: parse(/* GraphQL */ `
        query {
          post(id: "${data.posts[0].id}") {
            id
          }
        }
      `),
    });

    expect(findFirst).toHaveBeenCalled();
    expect(received.tx).toBe(db);
    expect(received.filter).toHaveProperty("where");
    expect(received.queryArgs).toHaveProperty("where");
  });

  test("custom findFirst result is returned as-is, bypassing the not-found assertion", async () => {
    const findFirst = mock(async () => undefined);

    const { rumble: r, build } = makeInstanceWithCustomHandlers(
      db,
      data.users[0].id,
      { findFirst },
    );
    r.abilityBuilder.posts.allow(["read"]);

    const { executor } = build();
    const res = await executor({
      document: parse(/* GraphQL */ `
        query {
          post(id: "${data.posts[0].id}") {
            id
          }
        }
      `),
    });

    expect(findFirst).toHaveBeenCalled();
    // the field is non-nullable, so a custom handler returning nothing surfaces
    // as a top-level GraphQL error rather than the default "not found" RumbleError
    expect((res as any).data).toBeNull();
    expect((res as any).errors.length).toEqual(1);
  });
});
