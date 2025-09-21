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
		rumble.abilityBuilder.users.allow(["update"]);

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
});
