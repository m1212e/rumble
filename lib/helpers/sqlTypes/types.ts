import { RumbleError } from "../../types/rumbleError";

/**
 * Strips parameter suffixes like `(256)`, `(10,2)` and timezone modifiers
 * (`with time zone`, `without time zone`) from raw getSQLType() output so
 * every classifier works on the base type name only.
 */
export function normalizeSQLType(raw: string): string {
  return raw
    .replace(/\s*with(?:out)?\s+time\s+zone/i, "")
    .replace(/\s*\([^)]*\)/, "")
    .trim()
    .toLowerCase();
}

const intLikeSQLTypeStrings = [
  "serial",
  "int",
  "integer",
  "tinyint",
  "smallint",
  "mediumint",
  "int2",
  "int4",
  "smallserial",
] as const;

export function isIntLikeSQLTypeString(sqlType: string): boolean {
  return intLikeSQLTypeStrings.includes(sqlType as any);
}

const bigIntLikeSQLTypeStrings = [
  "bigint",
  "bigserial",
  "int8",
  "bigint unsigned",
] as const;

export function isBigIntLikeSQLTypeString(sqlType: string): boolean {
  return bigIntLikeSQLTypeStrings.includes(sqlType as any);
}

const floatLikeSQLTypeStrings = [
  "real",
  "decimal",
  "double",
  "float",
  "numeric",
  "double precision",
  "float4",
  "float8",
  "money",
] as const;

export function isFloatLikeSQLTypeString(sqlType: string): boolean {
  return floatLikeSQLTypeStrings.includes(sqlType as any);
}

const stringLikeSQLTypeStrings = [
  "string",
  "text",
  "varchar",
  "char",
  "character varying",
  "character",
  "inet",
  "cidr",
  "macaddr",
  "macaddr8",
  "interval",
  "time",
  "year",
  "binary",
  "varbinary",
  "tinytext",
  "mediumtext",
  "longtext",
] as const;

export function isStringLikeSQLTypeString(sqlType: string): boolean {
  return stringLikeSQLTypeStrings.includes(sqlType as any);
}

const IDLikeSQLTypeStrings = ["uuid"] as const;

export function isIDLikeSQLTypeString(sqlType: string): boolean {
  return IDLikeSQLTypeStrings.includes(sqlType as any);
}

const booleanSQLTypeStrings = ["boolean", "bool"] as const;

export function isBooleanSQLTypeString(sqlType: string): boolean {
  return booleanSQLTypeStrings.includes(sqlType as any);
}

const dateTimeLikeSQLTypeStrings = ["timestamp", "datetime"] as const;

export function isDateTimeLikeSQLTypeString(sqlType: string): boolean {
  return dateTimeLikeSQLTypeStrings.includes(sqlType as any);
}

const dateLikeSQLTypeStrings = ["date"] as const;

export function isDateLikeSQLTypeString(sqlType: string): boolean {
  return dateLikeSQLTypeStrings.includes(sqlType as any);
}

const jsonLikeSQLTypeStrings = ["json", "jsonb"] as const;

export function isJSONLikeSQLTypeString(sqlType: string): boolean {
  return jsonLikeSQLTypeStrings.includes(sqlType as any);
}

const jsonFallbackSQLTypeStrings = [
  "point",
  "line",
  "lseg",
  "box",
  "path",
  "polygon",
  "circle",
  "geometry",
] as const;

export function isJSONFallbackSQLTypeString(sqlType: string): boolean {
  return (
    jsonFallbackSQLTypeStrings.includes(sqlType as any) ||
    sqlType.startsWith("geometry")
  );
}

const bytesSQLTypeStrings = ["bytea", "blob"] as const;

export function isBytesSQLTypeString(sqlType: string): boolean {
  return bytesSQLTypeStrings.includes(sqlType as any);
}

// PossibleSQLType is intentionally broad — classifiers receive normalized
// strings and use runtime includes() checks.
export type PossibleSQLType = string & {};

export const UnknownTypeRumbleError = (
  sqlType: string,
  additionalInfo?: string,
) =>
  new RumbleError(
    `RumbleError: Unknown SQL type '${sqlType}'. Please open an issue (https://github.com/m1212e/rumble/issues) so it can be added. (${additionalInfo})`,
  );
