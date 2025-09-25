import type { SchemaBuilderType } from "../../schemaBuilder";
import type { CheckedDrizzleInstance } from "../../types/drizzleInstanceType";
import type { CustomRumblePothosConfig } from "../../types/rumbleInput";
import {
	isBooleanSQLTypeString,
	isDateLikeSQLTypeString,
	isDateTimeLikeSQLTypeString,
	isFloatLikeSQLTypeString,
	isIDLikeSQLTypeString,
	isIntLikeSQLTypeString,
	isJSONLikeSQLTypeString,
	isStringLikeSQLTypeString,
	type PossibleSQLType,
	UnknownTypeRumbleError,
} from "./types";

export function mapSQLTypeToGraphQLType<
	UserContext extends Record<string, any>,
	DB extends CheckedDrizzleInstance,
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
>({ sqlType, fieldName }: { sqlType: PossibleSQLType; fieldName?: string }) {
	type ReturnType = Parameters<
		Parameters<Parameters<SchemaBuilder["queryField"]>[1]>[0]["field"]
	>[0]["type"];

	let ret: ReturnType | undefined;

	if (isIntLikeSQLTypeString(sqlType)) {
		ret = "Int";
	}

	if (isFloatLikeSQLTypeString(sqlType)) {
		ret = "Float";
	}

	if (isStringLikeSQLTypeString(sqlType)) {
		if (
			fieldName &&
			(fieldName.toLowerCase().endsWith("_id") ||
				fieldName.toLowerCase().endsWith("id"))
		) {
			ret = "ID";
		} else {
			ret = "String";
		}
	}

	if (isIDLikeSQLTypeString(sqlType)) {
		ret = "ID";
	}

	if (isBooleanSQLTypeString(sqlType)) {
		ret = "Boolean";
	}

	if (isDateTimeLikeSQLTypeString(sqlType)) {
		ret = "DateTime";
	}

	if (isDateLikeSQLTypeString(sqlType)) {
		ret = "Date";
	}

	if (isJSONLikeSQLTypeString(sqlType)) {
		ret = "JSON";
	}

	if (ret !== undefined) {
		return ret;
	}

	throw UnknownTypeRumbleError(sqlType, "SQL to GQL");
}
