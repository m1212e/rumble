import { beforeEach, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

// TODO: add test for relationally allowed write

describe("test rumble abilities", async () => {
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

  test("allow simple read with helper implementation", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

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

  test("deny simple read with helper implementation", async () => {
    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          post(id: "ee25b2d9-72ce-4839-3c39-c9de183c81ec") {
            id
          }
        }
      `),
    });

    expect((r as any).errors.length).toEqual(1);
    expect((r as any).errors.at(0).path).toEqual(["post"]);
  });

  test("omit indirect read with helper implementation", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

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
    expect((r as any).data.users.length).toEqual(9);
    // no user should have any posts returned
    expect(
      (r as any).data.users.filter((u: any) => u.posts.length > 0).length,
    ).toEqual(0);
  });

  test("allow indirect read with helper implementation", async () => {
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.posts.allow(["read"]);

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

    expect((r as any).data.users.length).toEqual(9);
    expect(
      (r as any).data.users.filter((u: any) => u.posts.length === 1).length,
    ).toEqual(2);
  });

  test("error indirect read with helper implementation on one to one with error on non nullable relationship", async () => {
    rumble.abilityBuilder.comments.allow(["read"]);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
            author {
              id
            }
          }
        }
      `),
    });

    expect((r as any).errors.length).toEqual(1);
    expect((r as any).errors.at(0).path).toEqual(["comments", 0, "author"]);
  });

  test("deny indirect read with helper implementation on one to one with error on nullable relationship", async () => {
    rumble.abilityBuilder.comments.allow(["read"]);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
            post {
              id
            }
          }
        }
      `),
    });

    expect((r as any).errors.length).toEqual(1);
    expect((r as any).errors.at(0).path).toEqual(["comments", 0, "post"]);
  });

  test("allow indirect read with helper implementation on one to one", async () => {
    rumble.abilityBuilder.comments.allow(["read"]);
    rumble.abilityBuilder.users.allow(["read"]);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
            author {
              id
            }
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(9);
    expect(
      (r as any).data.comments.filter((u: any) => u.author).length,
    ).toEqual(9);
  });

  test("allow read only with specific condition", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      where: {
        published: true,
      },
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(9);
  });

  test("deny with dynamic specific condition", async () => {
    rumble.abilityBuilder.comments.allow("read").when(() => {
      // here we could do
      // if(users.isLoggedIn()) {
      //   return { where: eq(schema.comments.ownerId, userId) };
      // }

      // in case we are not logged in we return nothing which MUST evaluate to not allowing things
      // instead of allowing everything like rumble.abilityBuilder.comments.allow("read") would do
      return undefined;
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(0);
  });

  test("deny read with dynamic specific condition AND static condition with diverging permissions", async () => {
    rumble.abilityBuilder.comments.allow("read").when(() => {
      return undefined;
    });
    rumble.abilityBuilder.comments.allow("read");

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(0);
  });

  test("allow read with dynamic specific wildcard condition", async () => {
    rumble.abilityBuilder.comments.allow("read").when(() => {
      return "allow";
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(9);
  });

  test("allow read only with specific condition based on request context", async () => {
    rumble.abilityBuilder.comments
      .allow("read")
      .when(({ userId }) => ({ where: { ownerId: userId } }));

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(2);
  });

  test("limit read amount with abilities", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      limit: 3,
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(3);
  });

  test("limit read amount with merge lower than ability in query argument", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      limit: 10,
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments(limit: 5) {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(5);
  });

  test("limit read amount with ability lower than merge in query argument", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      limit: 5,
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments(limit: 10) {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(5);
  });

  test("limit read amount to max value with OR-merged abilities", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      limit: 3,
    });

    rumble.abilityBuilder.comments.allow("read").when({
      limit: 4,
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(4);
  });

  test("error simple read with helper implementation with column restrictions", async () => {
    rumble.abilityBuilder.users.allow(["read"]).when({
      columns: {
        id: false,
        firstName: true,
        email: true,
      },
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "91eedc87-dd86-4473-997b-0c0bff3db1ba") {
            id
            firstName
            email
          }
        }
      `),
    });

    expect((r as any).errors.length).toEqual(1);
    expect((r as any).errors.at(0).path).toEqual(["user", "id"]);
  });

  test("error simple read with helper implementation with multiple column restrictions", async () => {
    rumble.abilityBuilder.users.allow(["read"]).when({
      columns: {
        id: false,
        firstName: false,
        email: true,
      },
    });

    rumble.abilityBuilder.users.allow(["read"]).when({
      columns: {
        id: false,
        firstName: true,
        email: true,
      },
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "91eedc87-dd86-4473-997b-0c0bff3db1ba") {
            id
            firstName
            email
          }
        }
      `),
    });

    expect((r as any).errors.length).toEqual(1);
    expect((r as any).errors.at(0).path).toEqual(["user", "id"]);
  });

  test("permissive columns with overlapping abilities", async () => {
    rumble.abilityBuilder.users.allow(["read"]).when({
      columns: {
        id: false,
        firstName: true,
      },
    });

    rumble.abilityBuilder.users.allow(["read"]).when({
      columns: {
        id: true,
        firstName: false,
      },
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "91eedc87-dd86-4473-997b-0c0bff3db1ba") {
            id
            firstName
          }
        }
      `),
    });

    expect((r as any).errors).toBeUndefined();
  });

  test("permissive columns with permissive abilities", async () => {
    rumble.abilityBuilder.users.allow(["read"]).when({
      columns: {
        id: false,
        firstName: true,
      },
    });

    rumble.abilityBuilder.users.allow(["read"]).when(() => {
      return "allow";
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "91eedc87-dd86-4473-997b-0c0bff3db1ba") {
            id
            firstName
          }
        }
      `),
    });

    expect((r as any).errors).toBeUndefined();
  });

  test("deny read with stacked wildcard permission", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      where: {
        AND: [{ published: true }, { published: false }],
      },
    });
    // we do not want this to take action since we already have a published condition
    // acting differently would allow to override the published condition which might lead to unexpected behavior
    rumble.abilityBuilder.comments.allow("read");

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(0);
  });

  test("pagination", async () => {
    rumble.abilityBuilder.comments.allow("read");

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments(offset: 3, limit: 3) {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(3);

    const r2 = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments(offset: 6, limit: 3) {
            id
          }
        }
      `),
    });

    expect((r2 as any).data.comments.length).toEqual(3);

    expect((r as any).data.comments[0].id).not.toEqual(
      (r2 as any).data.comments[0].id,
    );
  });

  test("pagination in relation", async () => {
    rumble.abilityBuilder.users.allow("read");
    rumble.abilityBuilder.comments.allow("read");

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
			users {
				comments(offset: 0) {
					id
				}
			}
        }
      `),
    });

    const r2 = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
				comments(offset: 1) {
					id
				}
			}
        }
      `),
    });

    expect((r as any).data.users[0].comments[0].id).not.toEqual(
      (r2 as any).data.users[0].comments[0].id,
    );
  });

  test("count query", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          usersCount
        }
      `),
    });

    expect((r as any).data.usersCount).toEqual(200);
  });

  test("count query no permissions", async () => {
    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          usersCount
        }
      `),
    });

    expect((r as any).data.usersCount).toEqual(0);
  });

  test("OR-merge two ability where conditions returns rows matching either", async () => {
    // ability A: only published comments
    rumble.abilityBuilder.comments.allow("read").when({
      where: { published: true },
    });
    // ability B: only unpublished comments
    rumble.abilityBuilder.comments.allow("read").when({
      where: { published: false },
    });

    // OR semantics: published=true OR published=false → all comments (up to defaultLimit of 9)
    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    expect((r as any).data.comments.length).toEqual(9);
  });

  test("OR-merge: single ability where condition still filters correctly", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      where: { published: true },
    });

    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
            published
          }
        }
      `),
    });

    // single filter is not reduced via OR; all returned comments must be published
    // (SQLite stores booleans as 0/1, so use truthy check)
    expect((r as any).errors).toBeUndefined();
    expect((r as any).data.comments.every((c: any) => !!c.published)).toBe(
      true,
    );
  });

  test("OR-merge: dynamic ability OR static ability allows union of results", async () => {
    // static: only comments by current user
    rumble.abilityBuilder.comments
      .allow("read")
      .when(({ userId }) => ({ where: { ownerId: userId } }));
    // static: only published comments
    rumble.abilityBuilder.comments.allow("read").when({
      where: { published: true },
    });

    // should return comments that are either owned by the user OR published
    const { executor, yogaInstance: _yogaInstance } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
          }
        }
      `),
    });

    // there are user-owned comments and published comments; OR means more than either alone
    expect((r as any).data.comments.length).toBeGreaterThan(0);
  });

  //TODO
  // test("perform read with applied condition and merge filters", async () => {
  // 	rumble.abilityBuilder.comments.allow("read").when({
  // 		limit: 100,
  // 		where: {
  // 			published: true,
  // 		},
  // 	});

  // 	rumble.schemaBuilder.mutationFields((t) => {
  // 		return {
  // 			customFindComments: t.drizzleField({
  // 				type: ["comments"],
  // 				resolve: (query, root, args, ctx, info) => {
  // 					return db.query.comments.findMany(
  // 						query(
  // 							ctx.abilities.comments.filter("read", {
  // 								inject: {
  // 									where: {
  // 										text: { like: "a" },
  // 									},
  // 								},
  // 							}).query.many,
  // 						),
  // 					);
  // 				},
  // 			}),
  // 		};
  // 	});

  // 	const { executor, yogaInstance } = build();
  // 	const r = await executor({
  // 		document: parse(/* GraphQL */ `
  //     query {
  //       customFindComments {
  //         id
  //       }
  //     }
  //   `),
  // 	});

  // 	expect((r as any).data.customFindComments.length).toEqual(0);
  // });

  // Static wildcard + column restriction ordering tests
  // postId is notNull in schema, so querying it when excluded triggers a real GraphQL error
  test("static allow() first, then allow().when(columns) second — all columns should be accessible via OR", async () => {
    rumble.abilityBuilder.comments.allow("read"); // unrestricted
    rumble.abilityBuilder.comments.allow("read").when({
      columns: { id: true, postId: false },
    });

    const { executor } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
            postId
          }
        }
      `),
    });

    // OR of (unrestricted) and (id: true, postId: false) should allow all columns
    expect((r as any).errors).toBeUndefined();
  });

  test("allow().when(columns) first, then static allow() second — bare allow() is a no-op once .when() was registered", async () => {
    rumble.abilityBuilder.comments.allow("read").when({
      columns: { id: true, postId: false },
    });
    // bare allow() after .when() is intentionally a no-op (safety: won't silently override conditions)
    rumble.abilityBuilder.comments.allow("read");

    const { executor } = build();
    const r = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
            postId
          }
        }
      `),
    });

    // postId is blocked and bare allow() didn't override — error expected
    expect((r as any).errors).toBeDefined();
  });
});
