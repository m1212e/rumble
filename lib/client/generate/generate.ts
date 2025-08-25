import { exists, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type GraphQLSchema, printSchema } from "graphql";
import { generateClient } from "./client";
import { makeTSRepresentation } from "./tsRepresentation";

export async function generateFromSchema({
	outputPath,
	schema,
	rumbleImportPath = "@m1212e/rumble",
	apiUrl,
	useExternalUrqlClient = false,
}: {
	schema: GraphQLSchema;
	outputPath: string;
	rumbleImportPath?: string;
	apiUrl: string;
	useExternalUrqlClient?: boolean | string;
}) {
	if (await exists(outputPath)) {
		await rm(outputPath, { recursive: true, force: true });
	}
	await mkdir(outputPath, { recursive: true });

	if (!outputPath.endsWith("/")) {
		outputPath += "/";
	}

	// const schemaString = printSchema(schema).replaceAll("`", "'");
	// const config: CodegenConfig = {
	// 	schema: schemaString,
	// 	// documents: ["src/**/*.tsx"],
	// 	generates: {
	// 		[outputPath]: {
	// 			preset: "client",
	// 			plugins: [],
	// 		},
	// 		[join(outputPath, "schema.graphql")]: {
	// 			plugins: ["schema-ast"],
	// 		},
	// 	},
	// };

	// console.info("Generating client at", outputPath);
	// await generate(config);

	const imports: string[] = [];
	let code = "";

	const typeMap = new Map<string, any>();
	for (const [key, object] of Object.entries(schema.getTypeMap())) {
		if (key.startsWith("__")) continue;
		typeMap.set(key, object);
	}

	for (const [key, object] of typeMap.entries()) {
		const rep = makeTSRepresentation(object);

		if (rep === key) {
			continue;
		}

		code += `
export type ${key} = ${makeTSRepresentation(object)};
		`;
	}

	const c = generateClient({
		apiUrl,
		useExternalUrqlClient,
		rumbleImportPath,
		availableSubscriptions: new Set(
			Object.keys(schema.getSubscriptionType()?.getFields() || {}),
		),
	});

	imports.push(...c.imports);
	code += c.code;

	await writeFile(
		join(outputPath, "client.ts"),
		`${imports.join("\n")}\n${code}`,
	);
}
