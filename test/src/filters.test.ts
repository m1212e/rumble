import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("test rumble abilities and filters", async () => {
	let { db, seedData } = await makeSeededDBInstanceForTest();
	let { rumble, build } = makeRumbleSeedInstance(db, seedData.users.at(0)?.id);

	beforeEach(async () => {
		const s = await makeSeededDBInstanceForTest();
		db = s.db;
		seedData = s.seedData;

		const r = makeRumbleSeedInstance(db, seedData.users.at(0)?.id);
		rumble = r.rumble;
		build = r.build;
	});

	test("allow simple read with helper implementation and applied filters", async () => {
		rumble.abilityBuilder.users.allow(["read"]);
		rumble.abilityBuilder.users.filter(["read"]).by(({ entities }) => entities);

		const { executor, yogaInstance } = build();
		const r = await executor({
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

	test("filter out everything on application level filters", async () => {
		rumble.abilityBuilder.users.allow(["read"]);
		rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
			return [];
		});

		const { executor, yogaInstance } = build();
		const r = await executor({
			document: parse(/* GraphQL */ `
        query {
          findManyUsers {
            id
          }
        }
      `),
		});

		// all users should be readable
		expect((r as any).data.findManyUsers.length).toEqual(0);
	});

	test("filter out some on application level filters", async () => {
		rumble.abilityBuilder.users.allow(["read"]);
		rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
			return entities.slice(3);
		});

		const { executor, yogaInstance } = build();
		const r = await executor({
			document: parse(/* GraphQL */ `
        query {
          findManyUsers {
            id
          }
        }
      `),
		});

		// all users should be readable
		expect((r as any).data.findManyUsers.length).toEqual(7);
	});

	test("filter out related on application level filters", async () => {
		rumble.abilityBuilder.users.allow(["read"]);
		rumble.abilityBuilder.posts.allow(["read"]);
		rumble.abilityBuilder.posts.filter("read").by(({ entities }) => {
			return [];
		});

		const { executor, yogaInstance } = build();
		const r = await executor({
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
});
