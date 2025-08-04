import { sql } from "drizzle-orm";
import { isPostgresDB } from "./helpers/determineDialectFromSchema";
import type { GenericDrizzleDbTypeConstraints } from "./types/genericDrizzleDbType";

export async function initSearchIfApplicable<
	DB extends GenericDrizzleDbTypeConstraints,
>(db: DB) {
	//TODO: make other dialects compatible
	if (!isPostgresDB(db)) {
		console.info(
			"Database dialect is not compatible with search, skipping search initialization.",
		);
		return;
	}

	console.info("Initializing pg_trgm extension for database search...");
	await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
	console.info("pg_trgm initialized successfully!");
}
