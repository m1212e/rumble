import type SchemaBuilder from "@pothos/core";
import type { SchemaBuilderType } from "../../schemaBuilder";
import type { GenericDrizzleDbTypeConstraints } from "../../types/genericDrizzleDbType";
import type { CustomRumblePothosConfig } from "../../types/rumbleInput";
import { type PossibleSQLType, UnknownTypeRumbleError } from "./types";

export function mapSQLTypeToGraphQLType<
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
	sqlType,
	fieldName,
	isPrimaryKey,
}: { sqlType: PossibleSQLType; isPrimaryKey?: boolean; fieldName?: string }) {
	type ReturnType = Parameters<
		Parameters<Parameters<SchemaBuilder["queryField"]>[1]>[0]["field"]
	>[0]["type"];

	let ret: ReturnType | undefined = undefined;

	if (
		["serial", "int", "integer", "tinyint", "smallint", "mediumint"].includes(
			sqlType,
		)
	) {
		ret = "Int";
	}

	if (["real", "decimal", "double", "float"].includes(sqlType)) {
		ret = "Float";
	}

	if (["string", "text", "varchar", "char", "text(256)"].includes(sqlType)) {
		if (
			isPrimaryKey &&
			fieldName &&
			(fieldName.toLowerCase().endsWith("_id") ||
				fieldName.toLowerCase().endsWith("id"))
		) {
			ret = "ID";
		} else {
			ret = "String";
		}
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

	throw UnknownTypeRumbleError(sqlType, "SQL to GQL");
}
