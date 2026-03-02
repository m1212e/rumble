import { beforeEach, describe, expect, mock, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("test rumble abilities and filters", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  // @ts-expect-error
  let { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;

    // @ts-expect-error
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
			  user(id: "${data.users[0].id}") {
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

  // TODO
  // test("filter out some related on application level filters with applied ability", async () => {
  //   rumble.abilityBuilder.users.allow(["read"]);
  //   // rumble.abilityBuilder.posts.allow(["read"]).when({
  //   //   where: {
  //   //     id: data.users[0].id,
  //   //   },
  //   // });
  //   rumble.abilityBuilder.posts.filter("read").by(({ entities }) => {
  //     return entities.slice(0, 3);
  //   });

  //   const { executor, yogaInstance: _yogaInstance } = build();
  //   const r = await executor({
  //     document: parse(/* GraphQL */ `
  //       query {
  //         users {
  //           id
  //           firstName
  //           posts {
  //             id
  // 	  title
  // 	  text
  //           }
  //         }
  //       }
  //     `),
  //   });

  //   // all users should be readable
  //   expect((r as any).data.users.length).toEqual(data.users.length);
  //   // no user should have any posts returned
  //   expect(
  //     (r as any).data.users
  //       .map((u: any) => u.posts)
  //       .filter((u: any) => u.length > 0).length,
  //   ).toEqual(1);
  // });

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
    const f1 = mock(({ entities }) => {
      return entities.slice(0, 10);
    });
    const f2 = mock(({ entities }) => {
      return entities.slice(0, 10);
    });
    rumble.abilityBuilder.users.filter("read").by(f1);
    rumble.abilityBuilder.users.filter("read").by(f2);

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

    expect(f1).toHaveBeenCalled();
    expect(f2).toHaveBeenCalled();

    // all users should be readable
    expect((r as any).data.users.length).toEqual(10);
  });

  test("filter out with prefetch", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    let ctxRef: any;
    let prefetchResultRef: any;
    const filter = mock(async ({ entities, context, prefetched }) => {
      expect(ctxRef).toBe(context);
      expect(prefetchResultRef).toBe(prefetched);
      return entities.slice(0, 10);
    });
    const prefetch = mock(async ({ context }) => {
      ctxRef = context;
      prefetchResultRef = { some: "data" };
      return prefetchResultRef;
    });
    rumble.abilityBuilder.users.filter("read").prefetch(prefetch).by(filter);

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

    expect(filter).toHaveBeenCalled();
    expect(prefetch).toHaveBeenCalled();

    // all users should be readable
    expect((r as any).data.users.length).toEqual(10);
  });

  test("filter function throw", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    const filter = mock(async () => {
      throw new Error("Filter error");
    });
    rumble.abilityBuilder.users.filter("read").by(filter);

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

    expect(filter).toHaveBeenCalled();
    expect((r as any).errors.length).toEqual(1);
  });

  test("prefetch throw", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    const filter = mock(async () => {
      throw new Error("Filter error");
    });
    const prefetch = mock(async () => {
      throw new Error("Filter error");
    });
    rumble.abilityBuilder.users.filter("read").prefetch(prefetch).by(filter);

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

    expect(filter).toBeCalledTimes(0);
    expect(prefetch).toHaveBeenCalled();
    expect((r as any).errors.length).toEqual(1);
  });

  test("nested prefetching", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    const prefetch = mock(async () => {
      return {};
    });
    rumble.abilityBuilder.users
      .filter(["read"])
      .prefetch(prefetch)
      .by(({ entities }) => entities);
    rumble.abilityBuilder.posts
      .filter(["read"])
      .prefetch(prefetch)
      .by(({ entities }) => entities);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
			query {
			  user(id: "${data.users[0].id}") {
				id
				firstName
				posts {
				  id
				}
			  }
			}
		  `),
    });

    expect(prefetch).toBeCalledTimes(2);
  });
});
