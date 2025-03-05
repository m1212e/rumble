import { beforeAll } from "bun:test";
import { faker } from "@faker-js/faker";
import { and, eq } from "drizzle-orm";
import { rumble } from "../../lib";
import { db } from "./db/db";
import type * as schema from "./db/schema";
import { seedTestData } from "./db/seed";

export const testUsers: (typeof schema.users.$inferSelect)[] = [];

beforeAll(async () => {
	faker.seed(123);
	const seedData = await seedTestData();
	users.push(...seedData.users);
});
