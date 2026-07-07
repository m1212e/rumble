import { describe, expect, test } from "bun:test";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgEnum, pgTable, serial } from "drizzle-orm/pg-core";
import { printSchema } from "graphql";
import { rumble } from "../../lib";

describe("where filters on enum array columns", () => {
  const moodEnum = pgEnum("mood_array_native", ["sad", "ok", "happy"] as const);
  const things = pgTable("things_table_for_enum_array_where_test", {
    id: serial().primaryKey().notNull(),
    moods: moodEnum().array().notNull().default([]),
  });
  const schemaModule = { things, moodEnum };
  const relations = defineRelations(schemaModule, () => ({ things: {} }));
  const db = drizzle("postgres://nope:nope@localhost:5432/none", { relations });

  const r = rumble({
    db,
    schema: schemaModule,
    context() {
      return {};
    },
  });
  r.whereArg({ table: "things" });
  const sdl = printSchema(r.buildSchema());
  const enumArrayInput = sdl.match(
    /input \w+EnumWhereInputArgument \{[^}]*\}/,
  )?.[0];

  test("generates a dedicated where input for the enum array column", () => {
    expect(enumArrayInput).toBeDefined();
  });

  test("eq/ne accept whole-array values", () => {
    expect(enumArrayInput).toMatch(/eq: \[\w+Enum!\]\n/);
    expect(enumArrayInput).toMatch(/ne: \[\w+Enum!\]\n/);
  });

  test("in/notIn accept lists of array values", () => {
    expect(enumArrayInput).toMatch(/in: \[\[\w+Enum!\]!\]/);
    expect(enumArrayInput).toMatch(/notIn: \[\[\w+Enum!\]!\]/);
  });

  test("array operators accept array values", () => {
    expect(enumArrayInput).toMatch(/arrayContains: \[\w+Enum!\]/);
    expect(enumArrayInput).toMatch(/arrayOverlaps: \[\w+Enum!\]/);
    expect(enumArrayInput).toMatch(/arrayContained: \[\w+Enum!\]/);
  });

  test("drizzle builds SQL for eq with an array value on an array column", () => {
    expect(() =>
      db.query.things.findMany({ where: { moods: { eq: ["happy"] } } }).toSQL(),
    ).not.toThrow();
  });

  test("drizzle cannot build SQL for eq with a single value on an array column", () => {
    // this is why the where input must expose eq as a list type:
    // the pg array codec calls .map on the value while encoding
    expect(() =>
      db.query.things
        .findMany({ where: { moods: { eq: "happy" as any } } })
        .toSQL(),
    ).toThrow();
  });
});
