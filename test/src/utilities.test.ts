import { describe, expect, test } from "bun:test";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  PgEnumColumn,
  PgEnumObjectColumn,
  pgEnum,
  pgTable,
  serial,
} from "drizzle-orm/pg-core";
import { rumble } from "../../lib";
import { createEnumImplementer, isEnumSchema } from "../../lib/enum";
import {
  determineDBDialectFromSchema,
  isMySQLDB,
  isPostgresDB,
  isSQLiteDB,
} from "../../lib/helpers/determineDialectFromSchema";
import { mapSQLTypeToGraphQLType } from "../../lib/helpers/sqlTypes/mapSQLTypeToTSType";
import { UnknownTypeRumbleError } from "../../lib/helpers/sqlTypes/types";
import { RumbleError } from "../../lib/types/rumbleError";
import { makeSeededDBInstanceForTest } from "./db/db";

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
  const testObjectEnum = pgEnum("test_status_obj", {
    ACTIVE: "active",
    INACTIVE: "inactive",
  });
  const testTable = pgTable("test_table_enum", {
    status: testEnum(),
    statusObj: testObjectEnum(),
  });

  test("returns true for a PgEnumColumn (array-style enum)", () => {
    expect(testTable.status).toBeInstanceOf(PgEnumColumn);
    expect(isEnumSchema(testTable.status)).toBe(true);
  });

  test("returns true for a PgEnumObjectColumn (object-style enum, new in drizzle 1.0)", () => {
    expect(testTable.statusObj).toBeInstanceOf(PgEnumObjectColumn);
    expect(testTable.statusObj).not.toBeInstanceOf(PgEnumColumn);
    expect(isEnumSchema(testTable.statusObj)).toBe(true);
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

describe("enumImplementer", () => {
  const moodEnum = pgEnum("mood_native", ["sad", "ok", "happy"] as const);
  const objectEnum = pgEnum("object_native", {
    ACTIVE: "active",
    INACTIVE: "inactive",
  });
  const things = pgTable("things_table_for_enum_test", {
    id: serial().primaryKey().notNull(),
    mood: moodEnum(),
    status: objectEnum(),
  });
  const schemaModule = { things, moodEnum, objectEnum };
  const relations = defineRelations(schemaModule, () => ({ things: {} }));
  const db = drizzle("postgres://nope:nope@localhost:5432/none", { relations });

  const makeRumble = () =>
    rumble({
      db,
      schema: schemaModule,
      context() {
        return {};
      },
    });

  test("resolves via 'enum' option (array-style)", () => {
    expect(() => makeRumble().enum_({ enum: moodEnum })).not.toThrow();
  });

  test("resolves via 'enum' option (object-style)", () => {
    expect(() => makeRumble().enum_({ enum: objectEnum })).not.toThrow();
  });

  test("resolves via 'enumColumn' option (array-style)", () => {
    expect(() => makeRumble().enum_({ enumColumn: things.mood })).not.toThrow();
  });

  test("resolves via 'enumColumn' option (object-style)", () => {
    expect(() =>
      makeRumble().enum_({ enumColumn: things.status }),
    ).not.toThrow();
  });

  test("resolves via 'tsName' option (array-style)", () => {
    expect(() => makeRumble().enum_({ tsName: "moodEnum" })).not.toThrow();
  });

  test("resolves via 'tsName' option (object-style)", () => {
    expect(() => makeRumble().enum_({ tsName: "objectEnum" })).not.toThrow();
  });

  test("tsName, enum, and enumColumn all resolve to the same cached ref", () => {
    const r = makeRumble();
    const a = r.enum_({ tsName: "moodEnum" });
    const b = r.enum_({ enum: moodEnum });
    const c = r.enum_({ enumColumn: things.mood });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("throws a helpful error when 'schema' is not passed to rumble()", () => {
    expect(() =>
      (rumble as any)({
        db,
        context() {
          return {};
        },
      }),
    ).toThrow(/rumble requires the drizzle schema object/);
    expect(() =>
      (rumble as any)({
        db,
        schema: {},
        context() {
          return {};
        },
      }),
    ).toThrow(/rumble requires the drizzle schema object/);
  });

  test("throws when 'tsName' references an identifier that is not a pgEnum", () => {
    const r = makeRumble();
    expect(() => (r.enum_ as any)({ tsName: "things" })).toThrow(
      /Could not find a pgEnum/,
    );
    expect(() => (r.enum_ as any)({ tsName: "doesNotExist" })).toThrow(
      /Could not find a pgEnum/,
    );
  });

  test("throws when called with no recognized identifier", () => {
    const r = makeRumble();
    expect(() => (r.enum_ as any)({})).toThrow(RumbleError);
    expect(() => (r.enum_ as any)({})).toThrow(
      /Could not determine enum structure/,
    );
  });

  test("auto-implements object-style enum columns inside object()", () => {
    const r = makeRumble();
    expect(() => r.object({ table: "things" })).not.toThrow();
    expect(() => r.whereArg({ table: "things" })).not.toThrow();
    const schema = r.buildSchema();
    const sdl = require("graphql").printSchema(schema);
    expect(sdl).toContain("ObjectnativeEnum");
    expect(sdl).toContain("MoodnativeEnum");
  });

  test("custom refName overrides the auto-generated GraphQL type name", () => {
    expect(() =>
      makeRumble().enum_({ tsName: "moodEnum", refName: "MyCustomMood" }),
    ).not.toThrow();
  });
});
