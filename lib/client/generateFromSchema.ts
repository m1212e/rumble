import { exists, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CodegenConfig, generate } from "@graphql-codegen/cli";
import {
	type GraphQLField,
	type GraphQLFieldMap,
	type GraphQLInputType,
	GraphQLObjectType,
	type GraphQLSchema,
	printSchema,
} from "graphql";

export async function generateFromSchema({
	outputPath,
	schema,
	rumbleImportPath = "@m1212e/rumble",
	apiUrl,
}: {
	schema: GraphQLSchema;
	outputPath: string;
	rumbleImportPath?: string;
	apiUrl: string;
}) {
	if (await exists(outputPath)) {
		await rm(outputPath, { recursive: true, force: true });
	}
	await mkdir(outputPath, { recursive: true });

	const schemaString = printSchema(schema).replaceAll("`", "'");

	if (!outputPath.endsWith("/")) {
		outputPath += "/";
	}

	const config: CodegenConfig = {
		schema: schemaString,
		// documents: ["src/**/*.tsx"],
		generates: {
			[outputPath]: {
				preset: "client",
				plugins: [],
			},
			[join(outputPath, "schema.graphql")]: {
				plugins: ["schema-ast"],
			},
		},
	};

	console.info("Generating client at", outputPath);
	await generate(config);

	const output = `import { Client, cacheExchange, fetchExchange } from '@urql/core';
import { makeQuery } from "${rumbleImportPath}";
import type { Query } from "./graphql";

const urqlClient = new Client({
  url: "${apiUrl}",
  fetchSubscriptions: true,
  exchanges: [ cacheExchange, fetchExchange ],
  fetchOptions: {
		credentials: "include",
	},
});

export const client = {
	query: makeQuery<Query>({
		urqlClient,
		availableSubscriptions: new Set([${Object.keys(
			schema.getSubscriptionType()?.getFields() ?? {},
		)
			.map((e) => `"${e}"`)
			.join(", ")}]),
	}),
};
`;

	await writeFile(join(outputPath, "client.ts"), output);
}
