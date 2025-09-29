import { beforeEach, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("test rumble abilities and filters", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  let { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;

    const r = makeRumbleSeedInstance(db, data.users.at(0)?.id);
    rumble = r.rumble;
    build = r.build;
  });

  test("allow simple read with helper implementation and applied filters", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.users.filter(["read"]).by(({ entities }) => entities);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
			query {
			  user(id: "3e0bb3d0-2074-4a1e-6263-d13dd10cb0cf") {
				id
				firstName
			  }
			}
		  `),
    });

    expect(r).toEqual({
      data: {
        user: {
          id: data.users[0].id,
          firstName: data.users[0].firstName,
        },
      },
    });
  });

  test("filter out one on application level filters", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.users.filter("read").by(({ entities: _entities }) => {
      return [];
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "3e0bb3d0-2074-4a1e-6263-d13dd10cb0cf") {
				id
				firstName
			  }
        }
      `),
    });

    expect((r as any).errors.length).toEqual(1);
  });

  test("filter out everything on application level filters", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.users.filter("read").by(({ entities: _entities }) => {
      return [];
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
          }
        }
      `),
    });

    // all users should be readable
    expect((r as any).data.users.length).toEqual(0);
  });

  test("filter out some on application level filters", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
      return entities.slice(3);
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
          }
        }
      `),
    });

    // all users should be readable
    expect((r as any).data.users.length).toEqual(197);
  });

  test("filter out related on application level filters", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.posts.allow(["read"]);
    rumble.abilityBuilder.posts.filter("read").by(({ entities: _entities }) => {
      return [];
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            firstName
            posts {
              id
            }
          }
        }
      `),
    });

    // all users should be readable
    expect((r as any).data.users.length).toEqual(data.users.length);
    // no user should have any posts returned
    expect(
      (r as any).data.users.filter((u: any) => u.posts.length > 0).length,
    ).toEqual(0);
  });

  test("filter out some related on application level filters with applied ability", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.posts.allow(["read"]).when({
      where: {
        id: "c4391cfa-dd0e-4f2c-843f-a2aec9f8a396",
      },
    });
    rumble.abilityBuilder.posts.filter("read").by(({ entities }) => {
      return entities.slice(0, 3);
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            firstName
            posts {
              id
			  title
			  text
            }
          }
        }
      `),
    });

    // all users should be readable
    expect((r as any).data.users.length).toEqual(data.users.length);
    // no user should have any posts returned
    expect(
      (r as any).data.users
        .map((u: any) => u.posts)
        .filter((u: any) => u.length > 0).length,
    ).toEqual(1);
  });

  test("ensure presence of non requested fields on entity in filter", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
      for (const e of entities) {
        expect(e).toHaveProperty("email");
        expect(e).toHaveProperty("firstName");
        expect(e).toHaveProperty("lastName");
      }

      return [];
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
          }
        }
      `),
    });

    // all users should be readable
    expect((r as any).data.users.length).toEqual(0);
  });

  test("filter out some on multiple application level filters", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
      return entities.slice(0, 10);
    });
    rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
      return entities.slice(10, 20);
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
          }
        }
      `),
    });

    // all users should be readable
    expect((r as any).data.users.length).toEqual(20);
  });

  test("filter out some on multiple application level filters with duplicates", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
      return entities.slice(0, 10);
    });
    rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
      return entities.slice(0, 10);
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
          }
        }
      `),
    });

    // all users should be readable
    expect((r as any).data.users.length).toEqual(10);
  });
});
