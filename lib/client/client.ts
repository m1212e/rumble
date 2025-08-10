import { exists, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { printSchema } from "graphql";
import type { SchemaBuilderType } from "../schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";
import type {
	CustomRumblePothosConfig,
	RumbleInput,
} from "../types/rumbleInput";

export const clientCreatorImplementer = <
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	PothosConfig extends CustomRumblePothosConfig,
	SchemaBuilder extends SchemaBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action,
		PothosConfig
	>,
>({
	builtSchema,
}: RumbleInput<UserContext, DB, RequestEvent, Action, PothosConfig> & {
	builtSchema: () => ReturnType<SchemaBuilder["toSchema"]>;
}) => {
	const clientCreator = async (
		outputPath: string,
		fileWriteOptions?: Parameters<typeof writeFile>[2],
	) => {
		const schema = builtSchema();
		if (await exists(outputPath)) {
			await rm(outputPath, { recursive: true, force: true });
		}
		await mkdir(outputPath, { recursive: true });

		const schemaString = printSchema(schema).replaceAll("`", "'");
		await Promise.all([
			writeFile(
				join(outputPath, "schema.graphql"),
				schemaString,
				fileWriteOptions,
			),
		]);
	};

	return clientCreator;
};
