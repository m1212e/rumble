import { describe, expect, test } from "bun:test";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as sqlite from "drizzle-orm/sqlite-core";
import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLObjectType,
} from "graphql";
import { rumble as makeRumble } from "../../lib";
import { makeTSRepresentation } from "../../lib/client/generate/tsRepresentation";
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

  describe("the search argument", () => {
    /** Registers every object, so relations resolve, with `users` configurable */
    function registerAll(
      r: ReturnType<typeof makeInstance>,
      userSearch?: { columns: ("email" | "firstName" | "lastName" | "id")[] },
    ) {
      r.object({ table: "users", refName: "User", search: userSearch });
      r.object({ table: "posts", refName: "Post" });
      r.object({ table: "comments", refName: "Comment" });
    }

    /** The values of a table's search field enum */
    function searchFieldsOf(r: ReturnType<typeof makeInstance>, base: string) {
      const fieldEnum = r.buildSchema().getType(`${base}SearchFieldEnum`);
      if (!(fieldEnum instanceof GraphQLEnumType)) throw new Error(base);
      return fieldEnum.getValues().map((value) => value.name);
    }

    test("takes a required term and an optional list of fields", () => {
      const r = makeInstance();
      registerAll(r);
      r.query({ table: "users" });

      const schema = r.buildSchema();
      const input = schema.getType("UsersSearchInputArgument");
      if (!(input instanceof GraphQLInputObjectType)) throw new Error();
      const fields = input.getFields();
      expect(Object.keys(fields).sort()).toEqual(["fields", "term"]);
      expect(fields.term.type.toString()).toEqual("String!");
      expect(fields.fields.type.toString()).toEqual("[UsersSearchFieldEnum!]");

      const usersQuery = (
        schema.getType("Query") as GraphQLObjectType
      ).getFields().users;
      const searchArg = usersQuery.args.find((arg) => arg.name === "search");
      expect(searchArg?.type.toString()).toEqual("UsersSearchInputArgument");
    });

    test("offers every text and id column by default", () => {
      const r = makeInstance();
      registerAll(r);
      r.query({ table: "comments" });

      expect(searchFieldsOf(r, "Comments").sort()).toEqual([
        "id",
        "ownerId",
        "postId",
        "text",
      ]);
    });

    test("offers only the columns the object names", () => {
      const r = makeInstance();
      // the query is registered before the object that names the columns
      r.query({ table: "users" });
      registerAll(r, { columns: ["email", "firstName"] });

      expect(searchFieldsOf(r, "Users").sort()).toEqual(["email", "firstName"]);
    });

    test("types the fields as the column names in the generated client", () => {
      const r = makeInstance();
      registerAll(r, { columns: ["email", "firstName"] });
      r.query({ table: "users" });

      const schema = r.buildSchema();
      const fieldEnum = schema.getType("UsersSearchFieldEnum");
      const input = schema.getType("UsersSearchInputArgument");
      if (!(fieldEnum instanceof GraphQLEnumType)) throw new Error();
      if (!(input instanceof GraphQLInputObjectType)) throw new Error();
      expect(makeTSRepresentation(fieldEnum)).toEqual('"email" | "firstName"');
      expect(makeTSRepresentation(input)).toContain(
        "fields?: UsersSearchFieldEnum[]",
      );
    });

    test("is shared by the list query and the relations of a table", () => {
      const r = makeInstance();
      registerAll(r);
      r.query({ table: "posts" });

      const schema = r.buildSchema();
      const postsArg = (schema.getType("Query") as GraphQLObjectType)
        .getFields()
        .posts.args.find((arg) => arg.name === "search");
      const relationArg = (schema.getType("User") as GraphQLObjectType)
        .getFields()
        .posts.args.find((arg) => arg.name === "search");
      expect(postsArg?.type).toBe(relationArg?.type);
    });

    test("is left out for a table without text or id columns", () => {
      const counters = sqlite.sqliteTable("counters", {
        value: sqlite.integer().notNull(),
      });
      const r = makeRumble({
        db: drizzle(":memory:", {
          relations: defineRelations({ counters }),
        }),
        schema: { counters },
        context: () => ({}),
        search: { enabled: true },
      });
      r.abilityBuilder.counters.allow("read");
      r.object({ table: "counters", refName: "Counter" });
      r.query({ table: "counters" });

      const schema = r.buildSchema();
      const countersQuery = (
        schema.getType("Query") as GraphQLObjectType
      ).getFields().counters;
      expect(countersQuery.args.map((arg) => arg.name)).not.toContain("search");
      expect(schema.getType("CountersSearchInputArgument")).toBeUndefined();
    });
  });
});
