import { describe, expect, test } from "bun:test";
import { GraphQLObjectType } from "graphql";
import { rumble as makeRumble } from "../../lib";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";

/**
 * How an object's `search` setting is checked and where it switches the
 * argument off. Matching itself needs Postgres: `search.postgres.test.ts`.
 */
describe("search columns on objects", async () => {
  const { db } = await makeSeededDBInstanceForTest();

  const makeInstance = () => {
    const r = makeRumble({
      db,
      schema,
      context: () => ({}),
      search: { enabled: true },
    });
    r.abilityBuilder.users.allow("read");
    r.abilityBuilder.posts.allow("read");
    r.abilityBuilder.comments.allow("read");
    return r;
  };

  /** The argument names of every field of a type, by field name */
  function argsOf(r: ReturnType<typeof makeInstance>, type: string) {
    const object = r.buildSchema().getType(type);
    if (!(object instanceof GraphQLObjectType)) throw new Error(type);
    return Object.fromEntries(
      Object.values(object.getFields()).map((field) => [
        field.name,
        field.args.map((arg) => arg.name),
      ]),
    );
  }

  test("a column the table does not have throws", () => {
    const r = makeInstance();
    expect(() =>
      // @ts-expect-error the type already refuses it
      r.object({ table: "users", search: { columns: ["nickname"] } }),
    ).toThrow(/does not have/);
  });

  test("a column that is neither text nor id throws", () => {
    const r = makeInstance();
    expect(() =>
      r.object({ table: "comments", search: { columns: ["someNumber"] } }),
    ).toThrow(/neither a text nor an id column/);
  });

  test("an empty column list throws", () => {
    const r = makeInstance();
    expect(() => r.object({ table: "users", search: { columns: [] } })).toThrow(
      /names no columns/,
    );
  });

  test("two objects of one table with different settings throw", () => {
    const r = makeInstance();
    r.object({ table: "users", search: { columns: ["email"] } });
    expect(() =>
      r.object({
        table: "users",
        refName: "OtherUser",
        search: { columns: ["firstName"] },
      }),
    ).toThrow(/different search settings/);
  });

  test("two objects of one table with the same columns are fine", () => {
    const r = makeInstance();
    r.object({ table: "users", search: { columns: ["email", "firstName"] } });
    expect(() =>
      r.object({
        table: "users",
        refName: "OtherUser",
        search: { columns: ["firstName", "email"] },
      }),
    ).not.toThrow();
  });

  test("`false` removes the argument from the list query and the relations", () => {
    const r = makeInstance();
    // the relation leading to posts is built before the posts object exists
    r.object({ table: "users", refName: "User" });
    r.object({ table: "posts", refName: "Post", search: false });
    r.object({ table: "comments", refName: "Comment" });
    r.query({ table: "users" });
    r.query({ table: "posts" });

    const query = argsOf(r, "Query");
    expect(query.posts).not.toContain("search");
    expect(query.users).toContain("search");

    const user = argsOf(r, "User");
    expect(user.posts).not.toContain("search");
    expect(user.comments).toContain("search");
  });
});
