import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getIntrospectedSchema,
  minifyIntrospectionQuery,
} from "@urql/introspection";
import { uneval } from "devalue";
import type { GraphQLSchema } from "graphql";
import { autoGenerationPreamble, generateClient } from "./client";
import { makeTSRepresentation } from "./tsRepresentation";

// Writes only when the content differs. Rewriting an identical file still
// counts as a change to a file watcher, and Vite reloads every open page for it.
async function writeFileIfChanged(path: string, content: string) {
  try {
    if ((await readFile(path, "utf8")) === content) return;
  } catch {}
  await writeFile(path, content);
}

export async function generateFromSchema({
  outputPath,
  schema,
  rumbleImportPath = "@m1212e/rumble/client",
  apiUrl,
  useExternalUrqlClient = false,
  removeExisting = true,
  forceReactivity,
  autoIncludeIdField,
}: {
  schema: GraphQLSchema;
  outputPath: string;
  rumbleImportPath?: string;
  apiUrl?: string;
  useExternalUrqlClient?: boolean | string;
  removeExisting?: boolean;
  forceReactivity?: boolean;
  autoIncludeIdField?: string | boolean;
}) {
  if (removeExisting) {
    try {
      await access(outputPath);
      await rm(outputPath, { recursive: true, force: true });
    } catch (_error) {}
  }

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
    forceReactivity,
    autoIncludeId: autoIncludeIdField,
  });

  imports.push(...c.imports);
  code += c.code;

  await Promise.all([
    writeFileIfChanged(
      join(outputPath, "client.ts"),
      `${autoGenerationPreamble}\n${imports.join("\n")}\n${code}`,
    ),
    writeFileIfChanged(
      join(outputPath, `${schemaFileName}.ts`),
      `${autoGenerationPreamble}
import type { IntrospectionQuery } from "graphql";
export const schema = ${uneval(minifyIntrospectionQuery(getIntrospectedSchema(schema), { includeEnums: true, includeScalars: true, includeInputs: true }))} as IntrospectionQuery`,
    ),
  ]);
}
