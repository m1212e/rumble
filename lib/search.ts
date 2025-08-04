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

	console.info("Initializing fuzzystrmatch extension for database search...");
	await db.execute(sql`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;`);
	console.info("fuzzystrmatch initialized successfully!");
}

// SELECT levenshtein_less_equal('extensive', 'exhaustive', 4);
