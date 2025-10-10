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

export function createDistinctValuesFromSQLType(sqlType: PossibleSQLType): {
  value1: any;
  value2: any;
} {
  if (isIntLikeSQLTypeString(sqlType)) {
    return {
      value1: 1,
      value2: 2,
    };
  }

  if (isFloatLikeSQLTypeString(sqlType)) {
    return {
      value1: 1.1,
      value2: 2.2,
    };
  }

  if (isStringLikeSQLTypeString(sqlType)) {
    return {
      value1: "a",
      value2: "b",
    };
  }

  if (isIDLikeSQLTypeString(sqlType)) {
    return {
      value1: "fba31870-5528-42d7-b27e-2e5ee657aea5",
      value2: "fc65db81-c2d1-483d-8a25-a30e2cf6e02d",
    };
  }

  if (isBooleanSQLTypeString(sqlType)) {
    return {
      value1: true,
      value2: false,
    };
  }

  if (isDateTimeLikeSQLTypeString(sqlType)) {
    return {
      value1: new Date(2022, 1, 1),
      value2: new Date(2022, 1, 2),
    };
  }

  if (isDateLikeSQLTypeString(sqlType)) {
    return {
      value1: new Date(2022, 1, 1),
      value2: new Date(2022, 1, 2),
    };
  }

  if (isJSONLikeSQLTypeString(sqlType)) {
    return {
      value1: { a: 1 },
      value2: { b: 2 },
    };
  }

  throw UnknownTypeRumbleError(sqlType, "Distinct");
}
