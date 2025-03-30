import { type PossibleSQLType, UnknownTypeRumbleError } from "./types";

export function createDistinctValuesFromSQLType(sqlType: PossibleSQLType): {
	value1: any;
	value2: any;
} {
	if (
		["serial", "int", "integer", "tinyint", "smallint", "mediumint"].includes(
			sqlType,
		)
	) {
		return {
			value1: 1,
			value2: 2,
		};
	}

	if (["real", "decimal", "double", "float"].includes(sqlType)) {
		return {
			value1: 1.1,
			value2: 2.2,
		};
	}

	if (["string", "text", "varchar", "char", "text(256)"].includes(sqlType)) {
		return {
			value1: "a",
			value2: "b",
		};
	}

	if (["uuid"].includes(sqlType)) {
		return {
			value1: "fba31870-5528-42d7-b27e-2e5ee657aea5",
			value2: "fc65db81-c2d1-483d-8a25-a30e2cf6e02d",
		};
	}

	if (["boolean"].includes(sqlType)) {
		return {
			value1: true,
			value2: false,
		};
	}

	if (["timestamp", "datetime"].includes(sqlType)) {
		return {
			value1: new Date(2022, 1, 1),
			value2: new Date(2022, 1, 2),
		};
	}

	if (["date"].includes(sqlType)) {
		return {
			value1: new Date(2022, 1, 1),
			value2: new Date(2022, 1, 2),
		};
	}

	if (["json"].includes(sqlType)) {
		return {
			value1: { a: 1 },
			value2: { b: 2 },
		};
	}

	throw UnknownTypeRumbleError(sqlType, "Distinct");
}
