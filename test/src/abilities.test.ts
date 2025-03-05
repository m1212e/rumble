import { beforeAll, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("test rumble abilities", async () => {
	let { db, seedData } = await makeSeededDBInstanceForTest();
	let { rumble, executor } = makeRumbleSeedInstance(
		db,
		seedData.users.at(0)?.id,
	);

	beforeAll(async () => {
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
});
