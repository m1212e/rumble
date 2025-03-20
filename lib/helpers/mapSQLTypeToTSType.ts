import { RumbleError } from "../types/rumbleError";

type GraphQLType = "int" | "string" | "boolean";

export function mapSQLTypeToTSType(sqlType: string): GraphQLType {
	if (["serial", "int", "integer"].includes(sqlType)) {
		return "int";
	}

	if (
		["string", "text", "varchar", "char", "text(256)", "uuid"].includes(sqlType)
	) {
		return "string";
	}

	if (sqlType === "boolean") {
		return "boolean";
	}

	throw new RumbleError(
		`RumbleError: Unknown SQL type '${sqlType}'. Please open an issue so it can be added.`,
	);
}
