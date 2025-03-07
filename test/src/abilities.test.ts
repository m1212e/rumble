import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("test rumble abilities", async () => {
	let { db, seedData } = await makeSeededDBInstanceForTest();
	let { rumble, executor } = makeRumbleSeedInstance(
		db,
		seedData.users.at(0)?.id,
	);

	beforeEach(async () => {
		const s = await makeSeededDBInstanceForTest();
		db = s.db;
		seedData = s.seedData;

		const r = makeRumbleSeedInstance(db, seedData.users.at(0)?.id);
		rumble = r.rumble;
		executor = r.executor;
	});

	test("allow simple read with helper implementation", async () => {
		rumble.abilityBuilder.users.allow(["read"]);

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findFirstUsers {
            id
            firstName
          }
        }
      `),
		});

		expect(r).toEqual({
			data: {
				findFirstUsers: {
					id: seedData.users[0].id,
					firstName: seedData.users[0].firstName,
				},
			},
		});
	});

	test("deny simple read with helper implementation", async () => {
		rumble.abilityBuilder.users.allow(["read"]);

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findFirstPosts {
            id
          }
        }
      `),
		});

		expect((r as any).errors.length).toEqual(1);
		expect((r as any).errors.at(0).path).toEqual(["findFirstPosts"]);
	});

	test("omit indirect read with helper implementation", async () => {
		rumble.abilityBuilder.users.allow(["read"]);

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findManyUsers {
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
		expect((r as any).data.findManyUsers.length).toEqual(seedData.users.length);
		// no user should have any posts returned
		expect(
			(r as any).data.findManyUsers.filter((u: any) => u.posts.length > 0)
				.length,
		).toEqual(0);
	});

	test("allow indirect read with helper implementation", async () => {
		rumble.abilityBuilder.users.allow(["read"]);
		rumble.abilityBuilder.posts.allow(["read"]);

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findManyUsers {
            id
            firstName
            posts {
              id
            }
          }
        }
      `),
		});

		expect((r as any).data.findManyUsers.length).toEqual(seedData.users.length);
		expect(
			(r as any).data.findManyUsers.filter((u: any) => u.posts.length === 1)
				.length,
		).toEqual(10);
	});

	test("deny indirect read with helper implementation on one to one", async () => {
		rumble.abilityBuilder.comments.allow(["read"]);

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findManyComments {
            id
            author {
              id
            }
          }
        }
      `),
		});

		expect((r as any).data.findManyComments.length).toEqual(10);
		expect(
			(r as any).data.findManyComments.filter((u) => u.author).length,
		).toEqual(0);
	});

	test("allow indirect read with helper implementation on one to one", async () => {
		rumble.abilityBuilder.comments.allow(["read"]);
		rumble.abilityBuilder.users.allow(["read"]);

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findManyComments {
            id
            author {
              id
            }
          }
        }
      `),
		});

		expect((r as any).data.findManyComments.length).toEqual(10);
		expect(
			(r as any).data.findManyComments.filter((u) => u.author).length,
		).toEqual(10);
	});

	test("allow read only with specific condition", async () => {
		rumble.abilityBuilder.comments
			.allow("read")
			.when({ where: eq(schema.comments.published, true) });

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findManyComments {
            id
          }
        }
      `),
		});

		expect((r as any).data.findManyComments.length).toEqual(5);
	});

	test("allow read only with specific condition based on request context", async () => {
		rumble.abilityBuilder.comments
			.allow("read")
			.when(({ userId }) => ({ where: eq(schema.comments.ownerId, userId) }));

		const r = await executor()({
			document: parse(/* GraphQL */ `
        query {
          findManyComments {
            id
          }
        }
      `),
		});

		expect((r as any).data.findManyComments.length).toEqual(1);
	});
});
