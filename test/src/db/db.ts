import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { seedTestDbInstance } from "./seed";

export async function makeSeededDBInstanceForTest() {
	const db = drizzle(":memory:", { schema });
	const seedData = await seedTestDbInstance(db);
	return { db, seedData };
}
