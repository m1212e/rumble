import type { SchemaBuilderType } from "../schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "../types/genericDrizzleDbType";
import { RumbleError } from "../types/rumbleError";

export function mapSQLTypeToGraphQLType<
	UserContext extends Record<string, any>,
	DB extends GenericDrizzleDbTypeConstraints,
	RequestEvent extends Record<string, any>,
	Action extends string,
	SchemaBuilder extends SchemaBuilderType<
		UserContext,
		DB,
		RequestEvent,
		Action
	>,
>(sqlType: string) {
	type ReturnType = Parameters<
		Parameters<Parameters<SchemaBuilder["queryField"]>[1]>[0]["field"]
	>[0]["type"];

	let ret: ReturnType | undefined = undefined;
	// Int
	// Float
	// String
	// ID
	// Boolean
	// DateTime
	// Date
	// JSON

	if (
		["serial", "int", "integer", "tinyint", "smallint", "mediumint"].includes(
			sqlType,
		)
	) {
		ret = "Int";
	}

	if (["real", "decimal", "real", "double", "float"].includes(sqlType)) {
		ret = "Float";
	}

	if (["string", "text", "varchar", "char", "text(256)"].includes(sqlType)) {
		ret = "String";
	}

	if (["uuid"].includes(sqlType)) {
		ret = "ID";
	}

	if (["boolean"].includes(sqlType)) {
		ret = "Boolean";
	}

	if (["timestamp", "datetime"].includes(sqlType)) {
		ret = "DateTime";
	}

	if (["date"].includes(sqlType)) {
		ret = "Date";
	}

	if (["json"].includes(sqlType)) {
		ret = "JSON";
	}

	if (ret !== undefined) {
		return ret;
	}

	throw new RumbleError(
		`RumbleError: Unknown SQL type '${sqlType}'. Please open an issue so it can be added.`,
	);
}
