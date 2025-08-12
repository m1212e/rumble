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
}: {
	schema: GraphQLSchema;
	outputPath: string;
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

	const output = `export const client = {
	query: ${query(schema)},
	mutation: ${mutation(schema)}
}`;

	await writeFile(join(outputPath, "client.ts"), output);
}

function query(schema: GraphQLSchema) {
	return `{
${Object.entries(schema.getQueryType()?.getFields() ?? {}).reduce(
	(acc, [key, field]) => {
		return (
			acc +
			`
		${key}: '${field.name}',`
		);
	},
	"",
)}
	}`;
}

function mutation(schema: GraphQLSchema) {
	// for (const [key, field] of Object.entries(
	// 	schema.getQueryType()?.getFields() ?? {},
	// )) {
	// 	queryField(field);
	// }
	// console.log(field);

	return `"string"`;
}

import "./query";
