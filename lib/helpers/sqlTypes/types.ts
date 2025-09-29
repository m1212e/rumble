import { RumbleError } from "../../types/rumbleError";

const intLikeSQLTypeStrings = [
  "serial",
  "int",
  "integer",
  "tinyint",
  "smallint",
  "mediumint",
] as const;

export function isIntLikeSQLTypeString(
  sqlType: string,
): sqlType is (typeof intLikeSQLTypeStrings)[number] {
  return intLikeSQLTypeStrings.includes(sqlType as any);
}

const floatLikeSQLTypeStrings = [
  "real",
  "decimal",
  "double",
  "float",
  "numeric",
] as const;

export function isFloatLikeSQLTypeString(
  sqlType: string,
): sqlType is (typeof floatLikeSQLTypeStrings)[number] {
  return floatLikeSQLTypeStrings.includes(sqlType as any);
}

const stringLikeSQLTypeStrings = [
  "string",
  "text",
  "varchar",
  "char",
  "text(256)",
] as const;

export function isStringLikeSQLTypeString(
  sqlType: string,
): sqlType is (typeof stringLikeSQLTypeStrings)[number] {
  return stringLikeSQLTypeStrings.includes(sqlType as any);
}

const IDLikeSQLTypeStrings = ["uuid"] as const;

export function isIDLikeSQLTypeString(
  sqlType: string,
): sqlType is (typeof IDLikeSQLTypeStrings)[number] {
  return IDLikeSQLTypeStrings.includes(sqlType as any);
}

const booleanSQLTypeStrings = ["boolean"] as const;

export function isBooleanSQLTypeString(
  sqlType: string,
): sqlType is (typeof booleanSQLTypeStrings)[number] {
  return booleanSQLTypeStrings.includes(sqlType as any);
}

const dateTimeLikeSQLTypeStrings = ["timestamp", "datetime"] as const;

export function isDateTimeLikeSQLTypeString(
  sqlType: string,
): sqlType is (typeof dateTimeLikeSQLTypeStrings)[number] {
  return dateTimeLikeSQLTypeStrings.includes(sqlType as any);
}

const dateLikeSQLTypeStrings = ["date"] as const;

export function isDateLikeSQLTypeString(
  sqlType: string,
): sqlType is (typeof dateLikeSQLTypeStrings)[number] {
  return dateLikeSQLTypeStrings.includes(sqlType as any);
}

const jsonLikeSQLTypeStrings = ["json"] as const;

export function isJSONLikeSQLTypeString(
  sqlType: string,
): sqlType is (typeof jsonLikeSQLTypeStrings)[number] {
  return jsonLikeSQLTypeStrings.includes(sqlType as any);
}

const possibleSQLTypesStrings = [
  ...intLikeSQLTypeStrings,
  ...floatLikeSQLTypeStrings,
  ...stringLikeSQLTypeStrings,
  ...IDLikeSQLTypeStrings,
  ...booleanSQLTypeStrings,
  ...dateTimeLikeSQLTypeStrings,
  ...dateLikeSQLTypeStrings,
  ...jsonLikeSQLTypeStrings,
] as const;

export type PossibleSQLType = (typeof possibleSQLTypesStrings)[number];

export const UnknownTypeRumbleError = (
  sqlType: string,
  additionalInfo?: string,
) =>
  new RumbleError(
    `RumbleError: Unknown SQL type '${sqlType}'. Please open an issue (https://github.com/m1212e/rumble/issues) so it can be added. (${additionalInfo})`,
  );
