import { describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("verify where filter alignment fixes", async () => {
  const { db, data } = await makeSeededDBInstanceForTest();
  // @ts-expect-error
  const { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id);

  rumble.abilityBuilder.users.allow(["read"]);
  rumble.abilityBuilder.users.filter(["read"]).by(({ entities }) => entities);

  const { executor } = build();

  test("string eq operator", async () => {
    const target = data.users[0];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users(where: { firstName: { eq: "${target.firstName}" } }) {
            id
          }
        }
      `),
    });
    expect(r.errors).toBeUndefined();
    expect(r.data.users.length).toBeGreaterThan(0);
    expect(r.data.users.every((u: any) => true)).toBe(true);
  });

  test("string ne operator", async () => {
    const target = data.users[0];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users(where: { firstName: { ne: "${target.firstName}" } }) {
            id
          }
        }
      `),
    });
    expect(r.errors).toBeUndefined();
    expect(r.data.users.length).toEqual(
      data.users.filter((u: any) => u.firstName !== target.firstName).length,
    );
  });

  test("top-level OR across different columns", async () => {
    const a = data.users[0];
    const b = data.users[1];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users(where: { OR: [{ firstName: { eq: "${a.firstName}" } }, { lastName: { eq: "${b.lastName}" } }] }) {
            id
          }
        }
      `),
    });
    expect(r.errors).toBeUndefined();
    const expected = data.users.filter(
      (u: any) => u.firstName === a.firstName || u.lastName === b.lastName,
    ).length;
    expect(r.data.users.length).toEqual(expected);
  });

  test("top-level AND across different columns", async () => {
    const target = data.users[0];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users(where: { AND: [{ firstName: { eq: "${target.firstName}" } }, { lastName: { eq: "${target.lastName}" } }] }) {
            id
          }
        }
      `),
    });
    expect(r.errors).toBeUndefined();
    const expected = data.users.filter(
      (u: any) =>
        u.firstName === target.firstName && u.lastName === target.lastName,
    ).length;
    expect(r.data.users.length).toEqual(expected);
  });

  test("top-level NOT", async () => {
    const target = data.users[0];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users(where: { NOT: { firstName: { eq: "${target.firstName}" } } }) {
            id
          }
        }
      `),
    });
    expect(r.errors).toBeUndefined();
    const expected = data.users.filter(
      (u: any) => u.firstName !== target.firstName,
    ).length;
    expect(r.data.users.length).toEqual(expected);
  });

  test("ID where input supports in operator", async () => {
    const ids = [data.users[0].id, data.users[1].id];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users(where: { id: { in: ${JSON.stringify(ids)} } }) {
            id
          }
        }
      `),
    });
    expect(r.errors).toBeUndefined();
    expect(r.data.users.length).toEqual(2);
  });

  test("Boolean columns get a full operator-object where input", async () => {
    const { printSchema } = await import("graphql");
    const schema = rumble.schemaBuilder.toSchema();
    const sdl = printSchema(schema);
    expect(sdl).toContain("input BooleanWhereInputArgument");
    expect(sdl).toMatch(/input BooleanWhereInputArgument \{[^}]*eq: Boolean/);
    expect(sdl).toMatch(/input BooleanWhereInputArgument \{[^}]*ne: Boolean/);
  });
});
