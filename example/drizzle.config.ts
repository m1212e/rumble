import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: {
		// biome-ignore lint/style/noNonNullAssertion: only an example
		url: process.env.DATABASE_URL!,
	},
});
