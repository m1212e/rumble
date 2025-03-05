import { expect, test } from "bun:test";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { parse } from "graphql";
import { rumble } from "../../lib";
import { makeSeededDBInstanceForTest } from "./db/db";

test("allow simple read with helper implementation", async () => {
	const { db, seedData } = await makeSeededDBInstanceForTest();
	const { abilityBuilder, query, object, yoga } = rumble({
		db,
		disableDefaultObjects: {
			mutation: true,
		},
	});

	abilityBuilder.users.allow(["read"]);

	object({ name: "User", tableName: "users" });
	query({ tableName: "users" });

	const yogaInstance = yoga();
	const executor = buildHTTPExecutor({
		fetch: yogaInstance.fetch,
		endpoint: "http://yoga/graphql",
	});

	const result = await executor({
		document: parse(/* GraphQL */ `
      query {
        findFirstUsers {
          id
          firstName
        }
      }
    `),
	});

	expect(result).toEqual({
		data: {
			findFirstUsers: {
				id: seedData.users[0].id,
				firstName: seedData.users[0].firstName,
			},
		},
	});
});
