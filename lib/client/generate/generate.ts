import { exists, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CodegenConfig, generate } from "@graphql-codegen/cli";
import { type GraphQLSchema, printSchema } from "graphql";
import { makeModel } from "./modelRef";
import { generateClient } from "./urqlClient";

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

	// const generatedTypeExports = (
	// 	await readFile(join(outputPath, "graphql.ts"), "utf-8")
	// )
	// 	.matchAll(/export type (\w+) = {/gms)
	// 	.toArray()
	// 	.map((e) => e[1]);
	// type Schema = { ${generatedTypeExports.map((e) => `${e}: schema.${e}`).join(", ")} };

	// const availableSubscriptions = new Set([${Object.keys(
	// 		schema.getSubscriptionType()?.getFields() ?? {},
	// 	)
	// 		.map((e) => `"${e}"`)
	// 		.join(", ")}])

	const imports: string[] = [];
	let code = "";

	const c = generateClient({
		apiUrl,
		useExternalUrqlClient,
	});

	imports.push(...c.imports);
	code += c.code;

	const typeMap = new Map<string, any>();
	for (const [key, object] of Object.entries(schema.getTypeMap())) {
		if (key.startsWith("__")) continue;
		typeMap.set(key, object);
	}

	const query = makeModel(typeMap.get("Query")!);

	console.log(query);

	// const stringifiedTypeMap = new Map<string, Generation>();
	// for (const [key, value] of typeMap) {
	// 	stringifiedTypeMap.set(key, makeModel(value));
	// }

	// console.log(stringifiedTypeMap);

	// /**
	//  * Client object to be used for the rumble api. Provides a nice, typesafe access to query all data from the api.
	//  * If existent (as per default if using the query implementation helpers) this automatically subscribes to subscriptions
	//  * which equal the query name provided. See the below example for usage.
	//  *
	//  * @example
	//  * \`\`\`ts
	//  *
	//  * import { client } from "./generated-client/client";
	//  *
	//  * // await to ensure there is data present in the response
	//  * // if not awaited, only the subscribe method will be available
	//  * const r = await client.data.users({
	//  *	id: true,
	//  *	name: true,
	//  *	posts: {
	//  *		id: true,
	//  *		content: true,
	//  *	},
	//  * });
	//  *
	//  * console.log("first user:", r[0]);
	//  * r.subscribe((users) => console.log("live user data:", users));
	//  *
	//  * \`\`\`
	//  */
	// export const client = {
	// 	data: makeQuery<Schema>({
	// 		urqlClient,
	// 	}),
	// };
	// `;

	await writeFile(
		join(outputPath, "client.ts"),
		`${imports.join("\n")}\n${code}`,
	);
}
