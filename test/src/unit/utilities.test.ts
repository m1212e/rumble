import { describe, expect, test } from "bun:test";
import { PgEnumColumn, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { isEnumSchema } from "../../../lib/enum";
import {
  determineDBDialectFromSchema,
  isMySQLDB,
  isPostgresDB,
  isSQLiteDB,
} from "../../../lib/helpers/determineDialectFromSchema";
import { mapSQLTypeToGraphQLType } from "../../../lib/helpers/sqlTypes/mapSQLTypeToTSType";
import { UnknownTypeRumbleError } from "../../../lib/helpers/sqlTypes/types";
import { makeSeededDBInstanceForTest } from "../db/db";

describe("mapSQLTypeToGraphQLType", () => {
  test("maps integer types to Int", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "integer" })).toBe("Int");
    expect(mapSQLTypeToGraphQLType({ sqlType: "int" })).toBe("Int");
    expect(mapSQLTypeToGraphQLType({ sqlType: "serial" })).toBe("Int");
  });

  test("maps float types to Float", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "numeric" })).toBe("Float");
    expect(mapSQLTypeToGraphQLType({ sqlType: "real" })).toBe("Float");
    expect(mapSQLTypeToGraphQLType({ sqlType: "decimal" })).toBe("Float");
    expect(mapSQLTypeToGraphQLType({ sqlType: "float" })).toBe("Float");
  });

  test("maps text to String", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "text" })).toBe("String");
    expect(mapSQLTypeToGraphQLType({ sqlType: "varchar" })).toBe("String");
  });

  test("maps text fields ending in 'id' to ID by field name heuristic", () => {
    expect(
      mapSQLTypeToGraphQLType({ sqlType: "text", fieldName: "userId" }),
    ).toBe("ID");
    expect(
      mapSQLTypeToGraphQLType({ sqlType: "text", fieldName: "post_id" }),
    ).toBe("ID");
    expect(mapSQLTypeToGraphQLType({ sqlType: "text", fieldName: "id" })).toBe(
      "ID",
    );
    expect(
      mapSQLTypeToGraphQLType({ sqlType: "text", fieldName: "title" }),
    ).toBe("String");
    expect(
      mapSQLTypeToGraphQLType({ sqlType: "text", fieldName: "name" }),
    ).toBe("String");
  });

  test("maps uuid to ID", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "uuid" })).toBe("ID");
  });

  test("maps boolean to Boolean", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "boolean" })).toBe("Boolean");
  });

  test("maps datetime types to DateTime", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "timestamp" })).toBe("DateTime");
    expect(mapSQLTypeToGraphQLType({ sqlType: "datetime" })).toBe("DateTime");
  });

  test("maps date to Date", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "date" })).toBe("Date");
  });

  test("maps json types to JSON", () => {
    expect(mapSQLTypeToGraphQLType({ sqlType: "json" })).toBe("JSON");
    expect(mapSQLTypeToGraphQLType({ sqlType: "jsonb" })).toBe("JSON");
  });

  test("throws for unknown SQL types", () => {
    expect(() =>
      mapSQLTypeToGraphQLType({ sqlType: "completely_unknown" as any }),
    ).toThrow();
  });
});

describe("UnknownTypeRumbleError", () => {
  test("produces an error with the unknown type name in the message", () => {
    const err = UnknownTypeRumbleError("weird_type", "test context");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("weird_type");
  });

  test("includes the github issues link so users know where to report", () => {
    const err = UnknownTypeRumbleError("xyz_type");
    expect(err.message).toContain("github.com/m1212e/rumble/issues");
  });

  test("includes the additional info when provided", () => {
    const err = UnknownTypeRumbleError("int_array", "mapping context");
    expect(err.message).toContain("mapping context");
  });
});

describe("dialect detection", async () => {
  const { db } = await makeSeededDBInstanceForTest();

  test("isSQLiteDB returns true for the SQLite test db", () => {
    expect(isSQLiteDB(db)).toBe(true);
  });

  test("isPostgresDB returns false for the SQLite test db", () => {
    expect(isPostgresDB(db)).toBe(false);
  });

  test("isMySQLDB returns false for the SQLite test db", () => {
    expect(isMySQLDB(db)).toBe(false);
  });

  test("determineDBDialectFromSchema returns 'sqlite' for the test db", () => {
    expect(determineDBDialectFromSchema(db._.relations as any)).toBe("sqlite");
  });

  test("determineDBDialectFromSchema throws when no tables are found", () => {
    expect(() => determineDBDialectFromSchema({} as any)).toThrow(
      "No tables found in schema",
    );
  });
});

describe("isEnumSchema", () => {
  const testEnum = pgEnum("test_status", ["active", "inactive", "pending"]);
  const testTable = pgTable("test_table_enum", {
    status: testEnum(),
  });

  test("returns true for a PgEnumColumn", () => {
    expect(testTable.status).toBeInstanceOf(PgEnumColumn);
    expect(isEnumSchema(testTable.status)).toBe(true);
  });

  test("returns false for a plain string column", () => {
    const { text, pgTable: makeTable } = require("drizzle-orm/pg-core");
    const plainTable = makeTable("plain", { name: text() });
    expect(isEnumSchema(plainTable.name)).toBe(false);
  });

  test("returns false for null, undefined, and primitives", () => {
    expect(isEnumSchema(null)).toBe(false);
    expect(isEnumSchema(undefined)).toBe(false);
    expect(isEnumSchema("string")).toBe(false);
    expect(isEnumSchema(42)).toBe(false);
    expect(isEnumSchema({})).toBe(false);
  });
});
