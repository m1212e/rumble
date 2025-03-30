import { RumbleError } from "../../types/rumbleError";

export const possibleSQLTypesStrings = [
	"serial",
	"int",
	"integer",
	"tinyint",
	"smallint",
	"mediumint",
	"real",
	"decimal",
	"double",
	"float",
	"string",
	"text",
	"varchar",
	"char",
	"text(256)",
	"uuid",
	"boolean",
	"date",
	"datetime",
	"timestamp",
	"json",
] as const;

export type PossibleSQLType = (typeof possibleSQLTypesStrings)[number];

export const UnknownTypeRumbleError = (
	sqlType: string,
	additionalInfo?: string,
) =>
	new RumbleError(
		`RumbleError: Unknown SQL type '${sqlType}'. Please open an issue (https://github.com/m1212e/rumble/issues) so it can be added. (${additionalInfo})`,
	);
