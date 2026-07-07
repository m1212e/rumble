import {
  isBigIntLikeSQLTypeString,
  isBooleanSQLTypeString,
  isBytesSQLTypeString,
  isDateLikeSQLTypeString,
  isDateTimeLikeSQLTypeString,
  isFloatLikeSQLTypeString,
  isIDLikeSQLTypeString,
  isIntLikeSQLTypeString,
  isJSONFallbackSQLTypeString,
  isJSONLikeSQLTypeString,
  isStringLikeSQLTypeString,
  normalizeSQLType,
  type PossibleSQLType,
  UnknownTypeRumbleError,
} from "./types";

export type GraphQLTypeName =
  | "Int"
  | "Float"
  | "String"
  | "ID"
  | "Boolean"
  | "DateTime"
  | "Date"
  | "JSON"
  | "BigInt"
  | "Bytes";

export function mapSQLTypeToGraphQLType({
  sqlType,
  fieldName,
}: {
  sqlType: PossibleSQLType;
  fieldName?: string;
}): GraphQLTypeName {
  // MySQL raw enum columns expose their values in the SQL type string.
  // Handle before normalization since normalization would strip the parens.
  if (/^enum\(/.test(sqlType)) {
    return "String";
  }

  const normalized = normalizeSQLType(sqlType);

  let ret: GraphQLTypeName | undefined;

  if (isIntLikeSQLTypeString(normalized)) {
    ret = "Int";
  }

  if (isBigIntLikeSQLTypeString(normalized)) {
    ret = "BigInt";
  }

  if (isFloatLikeSQLTypeString(normalized)) {
    ret = "Float";
  }

  if (isStringLikeSQLTypeString(normalized)) {
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

  if (isIDLikeSQLTypeString(normalized)) {
    ret = "ID";
  }

  if (isBooleanSQLTypeString(normalized)) {
    ret = "Boolean";
  }

  if (isDateTimeLikeSQLTypeString(normalized)) {
    ret = "DateTime";
  }

  if (isDateLikeSQLTypeString(normalized)) {
    ret = "Date";
  }

  if (isJSONLikeSQLTypeString(normalized)) {
    ret = "JSON";
  }

  if (isJSONFallbackSQLTypeString(normalized)) {
    ret = "JSON";
  }

  if (isBytesSQLTypeString(normalized)) {
    ret = "Bytes";
  }

  if (ret !== undefined) {
    return ret;
  }

  throw UnknownTypeRumbleError(sqlType, "SQL to GQL");
}
