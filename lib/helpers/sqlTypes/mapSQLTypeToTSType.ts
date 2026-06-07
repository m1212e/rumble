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

export function mapSQLTypeToGraphQLType({
  sqlType,
  fieldName,
}: {
  sqlType: PossibleSQLType;
  fieldName?: string;
}):
  | "Int"
  | "Float"
  | "String"
  | "ID"
  | "Boolean"
  | "DateTime"
  | "Date"
  | "JSON" {
  let ret:
    | "Int"
    | "Float"
    | "String"
    | "ID"
    | "Boolean"
    | "DateTime"
    | "Date"
    | "JSON"
    | undefined;

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
