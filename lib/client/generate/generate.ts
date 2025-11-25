import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getIntrospectedSchema,
  minifyIntrospectionQuery,
} from "@urql/introspection";
import { uneval } from "devalue";
import type { GraphQLSchema } from "graphql";
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
  apiUrl?: string;
  useExternalUrqlClient?: boolean | string;
}) {
  try {
    await access(outputPath);
    await rm(outputPath, { recursive: true, force: true });
  } catch (_error) {}

  await mkdir(outputPath, { recursive: true });

  if (!outputPath.endsWith("/")) {
    outputPath += "/";
  }

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
export type ${key} = ${rep};
		`;
  }

  const schemaFileName = "schema";

  const c = generateClient({
    apiUrl,
    schemaPath: `./${schemaFileName}`,
    useExternalUrqlClient,
    rumbleImportPath,
    availableSubscriptions: new Set(
      Object.keys(schema.getSubscriptionType()?.getFields() || {}),
    ),
  });

  imports.push(...c.imports);
  code += c.code;

  await Promise.all([
    writeFile(join(outputPath, "client.ts"), `${imports.join("\n")}\n${code}`),
    writeFile(
      join(outputPath, `${schemaFileName}.ts`),
      `// @ts-ignore
export const schema = ${uneval(minifyIntrospectionQuery(getIntrospectedSchema(schema)))}`,
    ),
  ]);
}
