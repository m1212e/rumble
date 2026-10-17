import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as t from "drizzle-orm/sqlite-core";
import { rumble } from "../../lib";

// a mix of the common column kinds, so all where/order input types appear
const columnKinds = [
  ["text", () => t.text()],
  ["int", () => t.integer()],
  ["flag", () => t.integer({ mode: "boolean" })],
  ["real", () => t.real().notNull()],
] as const;

/**
 * A synthetic schema of `tableCount` tables with `columnCount` columns each.
 * Every table belongs to the previous one, so each table has a one and a many
 * relation and the generated schema grows like a real one.
 */
export function makeWideSchema(tableCount: number, columnCount: number) {
  const schema: Record<string, any> = {};
  for (let i = 0; i < tableCount; i++) {
    const columns: Record<string, any> = { id: t.text().primaryKey() };
    for (let c = 0; c < columnCount; c++) {
      const [prefix, make] = columnKinds[c % columnKinds.length];
      columns[`${prefix}${c}`] = make();
    }
    if (i > 0) columns.parentId = t.text().notNull();
    schema[`table${i}`] = t.sqliteTable(`table_${i}`, columns);
  }

  const relations = defineRelations(schema, (r: any) => {
    const config: Record<string, any> = {};
    for (let i = 0; i < tableCount; i++) {
      const name = `table${i}`;
      config[name] = {};
      if (i > 0) {
        config[name].parent = r.one[`table${i - 1}`]({
          from: r[name].parentId,
          to: r[`table${i - 1}`].id,
          optional: false,
        });
      }
      if (i < tableCount - 1) {
        config[name].children = r.many[`table${i + 1}`]({
          from: r[name].id,
          to: r[`table${i + 1}`].parentId,
        });
      }
    }
    return config;
  });

  const db = drizzle(":memory:", { relations });
  return { db, schema, tableNames: Object.keys(schema) };
}

/** Registers object, query and count query helpers for every table. */
export function buildWideRumble(wide: ReturnType<typeof makeWideSchema>) {
  const r = rumble({ db: wide.db as any, schema: wide.schema });
  for (const table of wide.tableNames) {
    (r.abilityBuilder as any)[table].allow("read");
    r.object({ table: table as never });
    r.query({ table: table as never });
    r.countQuery({ table: table as never });
  }
  return r;
}
