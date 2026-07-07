import { describe, expect, test } from "bun:test";
import { defineRelations } from "drizzle-orm";
import { drizzle as sqliteDrizzle } from "drizzle-orm/bun-sqlite";
import * as mysql from "drizzle-orm/mysql-core";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql-proxy";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import * as pg from "drizzle-orm/pg-core";
import * as sqlite from "drizzle-orm/sqlite-core";
import { assertValidSchema, printSchema } from "graphql";
import { rumble } from "../../lib";

/**
 * Matrix test: which drizzle schema constellations produce a valid,
 * buildable GraphQL schema through the full rumble pipeline
 * (object + whereArg + orderArg + query).
 */

let probeCounter = 0;

function buildFor(
  makeColumn: (() => any) | null,
  dialect: "pg" | "sqlite" | "mysql",
  makeSchema?: () => Record<string, any>,
) {
  probeCounter++;
  const schemaModule =
    makeSchema?.() ??
    (() => {
      const value = makeColumn!();
      switch (dialect) {
        case "pg":
          return {
            t: pg.pgTable(`probe_${probeCounter}`, {
              id: pg.serial().primaryKey(),
              value,
            }),
          };
        case "sqlite":
          return {
            t: sqlite.sqliteTable(`probe_${probeCounter}`, {
              id: sqlite.integer().primaryKey(),
              value,
            }),
          };
        case "mysql":
          return {
            t: mysql.mysqlTable(`probe_${probeCounter}`, {
              id: mysql.serial().primaryKey(),
              value,
            }),
          };
      }
    })();

  const tableNames = Object.keys(schemaModule).filter((k) => {
    const v = (schemaModule as Record<string, unknown>)[k];
    return typeof v === "object" && v !== null;
  });
  const relations = defineRelations(
    schemaModule,
    () => Object.fromEntries(tableNames.map((n) => [n, {}])) as any,
  );
  const db =
    dialect === "pg"
      ? pgDrizzle("postgres://nope:nope@localhost:5432/none", { relations })
      : dialect === "sqlite"
        ? sqliteDrizzle(":memory:", { relations })
        : mysqlDrizzle(async () => ({ rows: [] }), { relations } as any);

  const r = rumble({
    db: db as any,
    schema: schemaModule,
    context() {
      return {};
    },
  } as any);
  for (const name of tableNames) {
    r.object({ table: name as any });
    (r as any).whereArg({ table: name });
    (r as any).orderArg({ table: name });
    r.query({ table: name as any });
  }
  const schema = r.buildSchema();
  assertValidSchema(schema);
  return printSchema(schema);
}

// -----------------------------------------------------------------------
// Supported column types — all must produce a valid schema without error
// -----------------------------------------------------------------------

const supported: Record<
  "pg" | "sqlite" | "mysql",
  Record<string, () => any>
> = {
  pg: {
    integer: () => pg.integer(),
    smallint: () => pg.smallint(),
    serial: () => pg.serial(),
    bigint: () => pg.bigint({ mode: "number" }),
    smallserial: () => pg.smallserial(),
    bigserial: () => pg.bigserial({ mode: "number" }),
    boolean: () => pg.boolean(),
    text: () => pg.text(),
    varchar: () => pg.varchar(),
    "varchar with length": () => pg.varchar({ length: 256 }),
    char: () => pg.char(),
    "char with length": () => pg.char({ length: 8 }),
    numeric: () => pg.numeric(),
    "numeric with precision": () => pg.numeric({ precision: 10, scale: 2 }),
    "numeric number mode": () => pg.numeric({ mode: "number" }),
    real: () => pg.real(),
    doublePrecision: () => pg.doublePrecision(),
    json: () => pg.json(),
    jsonb: () => pg.jsonb(),
    time: () => pg.time(),
    "time with tz": () => pg.time({ withTimezone: true }),
    timestamp: () => pg.timestamp(),
    "timestamp with timezone": () => pg.timestamp({ withTimezone: true }),
    "timestamp with precision": () => pg.timestamp({ precision: 3 }),
    "timestamp string mode": () => pg.timestamp({ mode: "string" }),
    date: () => pg.date(),
    "date string mode": () => pg.date({ mode: "string" }),
    interval: () => pg.interval(),
    point: () => pg.point(),
    line: () => pg.line(),
    uuid: () => pg.uuid(),
    inet: () => pg.inet(),
    cidr: () => pg.cidr(),
    macaddr: () => pg.macaddr(),
    "text array": () => pg.text().array(),
    "integer array": () => pg.integer().array(),
    "uuid array": () => pg.uuid().array(),
    "timestamp array": () => pg.timestamp().array(),
  },
  sqlite: {
    integer: () => sqlite.integer(),
    "integer boolean mode": () => sqlite.integer({ mode: "boolean" }),
    "integer timestamp mode": () => sqlite.integer({ mode: "timestamp" }),
    "integer timestamp_ms mode": () => sqlite.integer({ mode: "timestamp_ms" }),
    text: () => sqlite.text(),
    "text with length": () => sqlite.text({ length: 256 }),
    "text json mode": () => sqlite.text({ mode: "json" }),
    real: () => sqlite.real(),
    numeric: () => sqlite.numeric(),
    "numeric number mode": () => sqlite.numeric({ mode: "number" }),
  },
  mysql: {
    int: () => mysql.int(),
    tinyint: () => mysql.tinyint(),
    smallint: () => mysql.smallint(),
    mediumint: () => mysql.mediumint(),
    serial: () => mysql.serial(),
    bigint: () => mysql.bigint({ mode: "number" }),
    boolean: () => mysql.boolean(),
    text: () => mysql.text(),
    "varchar with length": () => mysql.varchar({ length: 256 }),
    "char with length": () => mysql.char({ length: 8 }),
    decimal: () => mysql.decimal(),
    double: () => mysql.double(),
    float: () => mysql.float(),
    real: () => mysql.real(),
    json: () => mysql.json(),
    date: () => mysql.date(),
    datetime: () => mysql.datetime(),
    timestamp: () => mysql.timestamp(),
    time: () => mysql.time(),
    year: () => mysql.year(),
    binary: () => mysql.binary(),
  },
};

for (const dialect of ["pg", "sqlite", "mysql"] as const) {
  describe(`${dialect} column types producing a valid schema`, () => {
    for (const [name, make] of Object.entries(supported[dialect])) {
      test(name, () => {
        expect(() => buildFor(make, dialect)).not.toThrow();
      });
    }
  });
}

// -----------------------------------------------------------------------
// Scalar type mappings — verify correct GQL type in SDL
// -----------------------------------------------------------------------

describe("scalar type mapping in SDL", () => {
  test("bigint column maps to BigInt scalar", () => {
    const sdl = buildFor(() => pg.bigint({ mode: "number" }), "pg");
    expect(sdl).toMatch(/value: BigInt/);
  });

  test("doublePrecision maps to Float", () => {
    const sdl = buildFor(() => pg.doublePrecision(), "pg");
    expect(sdl).toMatch(/value: Float/);
  });

  test("timestamp with timezone still maps to DateTime", () => {
    const sdl = buildFor(() => pg.timestamp({ withTimezone: true }), "pg");
    expect(sdl).toMatch(/value: DateTime/);
  });

  test("timestamp with precision still maps to DateTime", () => {
    const sdl = buildFor(() => pg.timestamp({ precision: 3 }), "pg");
    expect(sdl).toMatch(/value: DateTime/);
  });

  test("varchar with length maps to String", () => {
    const sdl = buildFor(() => pg.varchar({ length: 256 }), "pg");
    expect(sdl).toMatch(/value: String/);
  });

  test("interval maps to String", () => {
    const sdl = buildFor(() => pg.interval(), "pg");
    expect(sdl).toMatch(/value: String/);
  });

  test("inet maps to String", () => {
    const sdl = buildFor(() => pg.inet(), "pg");
    expect(sdl).toMatch(/value: String/);
  });

  test("point maps to JSON", () => {
    const sdl = buildFor(() => pg.point(), "pg");
    expect(sdl).toMatch(/value: JSON/);
  });

  test("mysql time maps to String", () => {
    const sdl = buildFor(() => mysql.time(), "mysql");
    expect(sdl).toMatch(/value: String/);
  });

  test("mysql year maps to String", () => {
    const sdl = buildFor(() => mysql.year(), "mysql");
    expect(sdl).toMatch(/value: String/);
  });
});

// -----------------------------------------------------------------------
// Where input accuracy — key operators must use the right types
// -----------------------------------------------------------------------

describe("where input types", () => {
  test("timestamp column gets DateTimeWhereInputArgument", () => {
    const sdl = buildFor(() => pg.timestamp(), "pg");
    expect(sdl).toContain("input DateTimeWhereInputArgument");
    expect(sdl).toMatch(/value: DateTimeWhereInputArgument/);
  });

  test("bigint column gets BigIntWhereInputArgument", () => {
    const sdl = buildFor(() => pg.bigint({ mode: "number" }), "pg");
    expect(sdl).toContain("input BigIntWhereInputArgument");
    expect(sdl).toMatch(/value: BigIntWhereInputArgument/);
  });

  test("text array column gets StringArrayWhereInputArgument", () => {
    const sdl = buildFor(() => pg.text().array(), "pg");
    expect(sdl).toContain("input StringArrayWhereInputArgument");
    expect(sdl).toMatch(/value: StringArrayWhereInputArgument/);
  });

  test("integer array column gets IntArrayWhereInputArgument", () => {
    const sdl = buildFor(() => pg.integer().array(), "pg");
    expect(sdl).toContain("input IntArrayWhereInputArgument");
    expect(sdl).toMatch(/value: IntArrayWhereInputArgument/);
  });

  test("StringArrayWhereInputArgument eq accepts list, in accepts list-of-lists", () => {
    const sdl = buildFor(() => pg.text().array(), "pg");
    const block = sdl.match(
      /input StringArrayWhereInputArgument \{[^}]*\}/,
    )?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(/eq: \[String!\]/);
    expect(block).toMatch(/in: \[\[String!\]!\]/);
    expect(block).toMatch(/arrayContains: \[String!\]/);
  });
});

// -----------------------------------------------------------------------
// Order input — relation fields must be excluded
// -----------------------------------------------------------------------

describe("order input excludes relation fields", () => {
  test("order input has no relation field, only columns", () => {
    probeCounter++;
    const post = pg.pgTable("order_post", {
      id: pg.serial().primaryKey(),
      title: pg.text(),
      authorId: pg.integer(),
    });
    const author = pg.pgTable("order_author", {
      id: pg.serial().primaryKey(),
      name: pg.text(),
    });
    const schemaModule = { post, author };
    const relations = defineRelations(schemaModule, (r) => ({
      post: {
        author: r.one.author({ from: r.post.authorId, to: r.author.id }),
      },
      author: { posts: r.many.post() },
    }));
    const db = pgDrizzle("postgres://nope:nope@localhost:5432/none", {
      relations,
    });
    const r = rumble({
      db: db as any,
      schema: schemaModule,
      context() {
        return {};
      },
      disableDefaultObjects: { mutation: true, subscription: true },
    } as any);
    r.object({ table: "post" as any });
    r.object({ table: "author" as any });
    r.query({ table: "post" as any });
    r.query({ table: "author" as any });
    const sdl = printSchema(r.buildSchema());

    const postOrderBlock = sdl.match(
      /input PostOrderInputArgument \{[^}]*\}/,
    )?.[0];
    expect(postOrderBlock).toBeDefined();
    // column fields must be present
    expect(postOrderBlock).toMatch(/id:/);
    expect(postOrderBlock).toMatch(/title:/);
    // relation field must NOT be present
    expect(postOrderBlock).not.toMatch(/author:/);
  });
});

// -----------------------------------------------------------------------
// MySQL enum support
// -----------------------------------------------------------------------

describe("mysql enum columns", () => {
  test("mysqlEnum column builds a valid schema", () => {
    expect(() =>
      buildFor(() => mysql.mysqlEnum(["a", "b"]), "mysql"),
    ).not.toThrow();
  });

  test("mysqlEnum column produces a GQL enum type in SDL", () => {
    const sdl = buildFor(() => mysql.mysqlEnum(["a", "b"]), "mysql");
    expect(sdl).toMatch(/enum \w+/);
    expect(sdl).toMatch(/a\s*\n/);
    expect(sdl).toMatch(/b\s*\n/);
  });

  test("named mysqlEnum column", () => {
    expect(() =>
      buildFor(() => mysql.mysqlEnum("my_named_status", ["x", "y"]), "mysql"),
    ).not.toThrow();
  });
});

// -----------------------------------------------------------------------
// Query-only APIs
// -----------------------------------------------------------------------

describe("query-only schema (no mutations)", () => {
  test("builds a valid schema without registering mutations", () => {
    probeCounter++;
    const t = pg.pgTable(`qonly_probe_${probeCounter}`, {
      id: pg.serial().primaryKey(),
    });
    const schemaModule = { t };
    const relations = defineRelations(schemaModule, () => ({ t: {} }));
    const db = pgDrizzle("postgres://nope:nope@localhost:5432/none", {
      relations,
    });
    const r = rumble({
      db: db as any,
      schema: schemaModule,
      context() {
        return {};
      },
    } as any);
    r.object({ table: "t" as any });
    r.query({ table: "t" as any });
    const schema = r.buildSchema();
    // must not throw — GraphQL validates that Mutation type (if present) has fields
    expect(() => assertValidSchema(schema)).not.toThrow();
    // Mutation root must be absent when no mutations were registered
    expect(schema.getMutationType()).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// pg enum constellations
// -----------------------------------------------------------------------

describe("pg enum constellations", () => {
  test("plain enum column", () => {
    expect(() =>
      buildFor(null, "pg", () => {
        const e = pg.pgEnum("matrix_mood_plain", ["a", "b"]);
        return {
          e,
          t: pg.pgTable("matrix_enum_plain", {
            id: pg.serial().primaryKey(),
            value: e(),
          }),
        };
      }),
    ).not.toThrow();
  });

  test("enum array column", () => {
    expect(() =>
      buildFor(null, "pg", () => {
        const e = pg.pgEnum("matrix_mood_arr", ["a", "b"]);
        return {
          e,
          t: pg.pgTable("matrix_enum_arr", {
            id: pg.serial().primaryKey(),
            value: e().array(),
          }),
        };
      }),
    ).not.toThrow();
  });

  test("same enum shared by two tables", () => {
    expect(() =>
      buildFor(null, "pg", () => {
        const e = pg.pgEnum("matrix_mood_shared", ["a", "b"]);
        return {
          e,
          t1: pg.pgTable("matrix_enum_shared_1", {
            id: pg.serial().primaryKey(),
            m: e(),
          }),
          t2: pg.pgTable("matrix_enum_shared_2", {
            id: pg.serial().primaryKey(),
            m: e().array(),
          }),
        };
      }),
    ).not.toThrow();
  });
});

// -----------------------------------------------------------------------
// Structural constellations
// -----------------------------------------------------------------------

describe("structural constellations", () => {
  test("table without primary key builds (subscriptions disabled)", () => {
    expect(() =>
      buildFor(null, "pg", () => ({
        t: pg.pgTable("matrix_nopk", { value: pg.text() }),
      })),
    ).not.toThrow();
  });

  test("composite primary key", () => {
    expect(() =>
      buildFor(null, "pg", () => ({
        t: pg.pgTable(
          "matrix_cpk",
          { a: pg.text().notNull(), b: pg.text().notNull() },
          (t) => [pg.primaryKey({ columns: [t.a, t.b] })],
        ),
      })),
    ).not.toThrow();
  });

  test("table inside a pgSchema", () => {
    expect(() =>
      buildFor(null, "pg", () => {
        const s = pg.pgSchema("matrix_myschema");
        return {
          t: s.table("matrix_schematable", {
            id: pg.serial().primaryKey(),
            value: pg.text(),
          }),
        };
      }),
    ).not.toThrow();
  });

  test("same table name in two pgSchemas (distinct ts names)", () => {
    expect(() =>
      buildFor(null, "pg", () => {
        const s1 = pg.pgSchema("matrix_s1");
        const s2 = pg.pgSchema("matrix_s2");
        return {
          users1: s1.table("users", {
            id: pg.serial().primaryKey(),
            a: pg.text(),
          }),
          users2: s2.table("users", {
            id: pg.serial().primaryKey(),
            b: pg.integer(),
          }),
        };
      }),
    ).not.toThrow();
  });

  test("self relation", () => {
    expect(() =>
      buildFor(null, "pg", () => ({
        node: pg.pgTable("matrix_node", {
          id: pg.serial().primaryKey(),
          parentId: pg.integer(),
        }),
      })),
    ).not.toThrow();
  });

  test("relation target without a registered object fails with a helpful rumble error", () => {
    probeCounter++;
    const a = pg.pgTable("matrix_rel_a", {
      id: pg.serial().primaryKey(),
      bId: pg.integer(),
    });
    const b = pg.pgTable("matrix_rel_b", { id: pg.serial().primaryKey() });
    const schemaModule = { a, b };
    const relations = defineRelations(schemaModule, (r) => ({
      a: { b: r.one.b({ from: r.a.bId, to: r.b.id }) },
      b: { as: r.many.a() },
    }));
    const db = pgDrizzle("postgres://nope:nope@localhost:5432/none", {
      relations,
    });
    const r = rumble({
      db: db as any,
      schema: schemaModule,
      context() {
        return {};
      },
      disableDefaultObjects: { mutation: true, subscription: true },
    } as any);
    r.object({ table: "a" as any });
    r.query({ table: "a" as any });
    expect(() => r.buildSchema()).toThrow(
      /has not been registered.*rumble\.object/,
    );
  });

  test("tables whose plural query names collide fail with a helpful rumble error", () => {
    expect(() =>
      buildFor(null, "pg", () => ({
        post: pg.pgTable("matrix_post", { id: pg.serial().primaryKey() }),
        posts: pg.pgTable("matrix_posts", { id: pg.serial().primaryKey() }),
      })),
    ).toThrow(/Duplicate query field/);
  });

  test("columns starting with __ are skipped silently (no build error)", () => {
    expect(() =>
      buildFor(null, "pg", () => ({
        t: pg.pgTable("matrix_underscore", {
          id: pg.serial().primaryKey(),
          __secret: pg.text(),
        }),
      })),
    ).not.toThrow();
  });

  test("skipped __ column is absent from the SDL", () => {
    const sdl = buildFor(null, "pg", () => ({
      t: pg.pgTable("matrix_underscore2", {
        id: pg.serial().primaryKey(),
        __secret: pg.text(),
      }),
    }));
    expect(sdl).not.toContain("__secret");
    expect(sdl).toContain("id:");
  });
});
