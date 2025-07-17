import { beforeEach, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("test rumble abilities", async () => {
	let { db, data, schema } = await makeSeededDBInstanceForTest();
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

		const { executor, yogaInstance } = build();
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

	test("deny simple read with helper implementation", async () => {
		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
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

	test("limit read amount to max value with abilities", async () => {
		rumble.abilityBuilder.comments.allow("read").when({
			limit: 3,
		});

		rumble.abilityBuilder.comments.allow("read").when({
			limit: 4,
		});

		const { executor, yogaInstance } = build();
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

		const { executor, yogaInstance } = build();
		const r = await executor({
			document: parse(/* GraphQL */ `
        query {
          user(id: "3e0bb3d0-2074-4a1e-6263-d13dd10cb0cf") {
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

	test("deny read with stacked wildcard permission", async () => {
		rumble.abilityBuilder.comments.allow("read").when({
			where: {
				AND: [{ published: true }, { published: false }],
			},
		});
		// we do not want this to take action since we already have a published condition
		// acting differently would allow to override the published condition which might lead to unexpected behavior
		rumble.abilityBuilder.comments.allow("read");

		const { executor, yogaInstance } = build();
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

	//TODO
	// test("perform read with applied condition and injection filters", async () => {
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
});
