import { beforeEach, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("test rumble basics", async () => {
  let { db, data, schema: _schema } = await makeSeededDBInstanceForTest();
  let { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id, 9);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;

    const r = makeRumbleSeedInstance(db, data.users.at(0)?.id, 9);
    rumble = r.rumble;
    build = r.build;
  });

  test("allow simple read without any conditions", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            firstName
          }
        }
      `),
    });

    expect((r as any).data.users).toHaveLength(9);
  });

  test("allow simple write without any conditions", async () => {
    rumble.abilityBuilder.users.allow(["update", "read"]);

    const newName = "NewFirstName";

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        mutation {
          updateUsername(userId: "${data.users[0].id}", firstName: "${newName}") {
            id
            firstName
          }
        }
      `),
    });

    expect((r as any).data.updateUsername.id).toBe(data.users[0].id);
    expect((r as any).data.updateUsername.firstName).toBe(newName);
  });

  test("do not allow simple write without any conditions", async () => {
    // note the wrong ability here
    rumble.abilityBuilder.users.allow(["read"]);

    const newName = "NewFirstName";

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        mutation {
          updateUsername(userId: "${data.users[0].id}", firstName: "${newName}") {
            id
            firstName
          }
        }
      `),
    });

    expect((r as any).errors).toBeDefined();
  });

  test("adjustment field full name", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            firstName
            lastName
            fullName
          }
        }
      `),
    });

    expect((r as any).data.users.length).toBeGreaterThan(0);
    expect((r as any).data.users[0].fullName).toBe(
      `${(r as any).data.users[0].firstName} ${(r as any).data.users[0].lastName}`,
    );
  });

  test("single entity lookup with non-existent ID returns an error", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

    const { executor } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "00000000-0000-0000-0000-000000000000") {
            id
          }
        }
      `),
    });

    expect((r as any).errors).toBeDefined();
    expect((r as any).errors.length).toBeGreaterThan(0);
  });

  test("defaultLimit caps list results when no explicit limit is given", async () => {
    const s = await makeSeededDBInstanceForTest();
    const r = makeRumbleSeedInstance(s.db, s.data.users[0].id, 2);
    r.rumble.abilityBuilder.users.allow(["read"]);
    const { executor } = r.build();

    const result = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
          }
        }
      `),
    });

    expect((result as any).errors).toBeUndefined();
    expect((result as any).data.users).toHaveLength(2);
  });

  test("isAllowed guard on countQuery blocks access when it returns false", async () => {
    rumble.abilityBuilder.comments.allow(["read"]);
    // Register a count query for comments with access permanently denied
    rumble.countQuery({
      table: "comments",
      isAllowed: async () => false,
    });

    const { executor } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          commentsCount
        }
      `),
    });

    expect((r as any).errors).toBeDefined();
    expect((r as any).errors.length).toBeGreaterThan(0);
  });

  test("isAllowed guard on countQuery permits access when it returns true", async () => {
    rumble.abilityBuilder.comments.allow(["read"]);
    rumble.countQuery({
      table: "comments",
      isAllowed: async () => true,
    });

    const { executor } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          commentsCount
        }
      `),
    });

    expect((r as any).errors).toBeUndefined();
    expect(typeof (r as any).data.commentsCount).toBe("number");
    expect((r as any).data.commentsCount).toBeGreaterThan(0);
  });
});
