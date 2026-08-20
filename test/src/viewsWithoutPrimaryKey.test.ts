import { beforeEach, describe, expect, test } from "bun:test";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  integer,
  sqliteTable,
  sqliteView,
  text,
} from "drizzle-orm/sqlite-core";
import { parse } from "graphql";
import { rumble } from "../../lib";

// Regression test: a schema that includes a view/materialized view (which
// structurally never has a primary key) must not crash ability building —
// only genuine tables missing a primary key should be treated as an error.
describe("schemas containing views without a primary key", () => {
  const things = sqliteTable("things_table_for_view_pk_test", {
    id: text().primaryKey(),
    quantity: integer().notNull(),
  });

  // A plain view over `things` — has no primary key of its own.
  const thingsView = sqliteView("things_view_for_view_pk_test", {
    id: text(),
    quantity: integer(),
  }).existing();

  const schemaModule = { things, thingsView };
  const relations = defineRelations(schemaModule, () => ({
    things: {},
  }));

  let db: ReturnType<typeof drizzle<typeof relations>>;

  beforeEach(() => {
    db = drizzle(":memory:", { relations });
    db.run(
      `create table things_table_for_view_pk_test (id text primary key, quantity integer not null)`,
    );
    db.run(
      `create view things_view_for_view_pk_test as select id, quantity from things_table_for_view_pk_test`,
    );
    db.run(
      `insert into things_table_for_view_pk_test (id, quantity) values ('a', 3)`,
    );
  });

  test("building abilities and executing a query does not throw", async () => {
    const r = rumble({
      db,
      schema: schemaModule,
      context() {
        return {};
      },
    });

    r.abilityBuilder.things.allow(["read"]);
    r.object({ table: "things" });
    r.query({ table: "things" });

    const yogaInstance = r.createYoga();
    const executor = buildHTTPExecutor({
      fetch: yogaInstance.fetch,
      endpoint: "http://yoga/graphql",
    });

    const result = await executor({
      document: parse(/* GraphQL */ `
        query {
          things {
            id
            quantity
          }
        }
      `),
    });

    expect((result as any).errors).toBeUndefined();
    expect((result as any).data.things).toEqual([{ id: "a", quantity: 3 }]);
  });

  test("the view is excluded from the ability builder and from ctx.abilities", () => {
    const r = rumble({
      db,
      schema: schemaModule,
      context() {
        return {};
      },
    });

    expect(Object.keys(r.abilityBuilder)).toContain("things");
    expect(Object.keys(r.abilityBuilder)).not.toContain("thingsView");
  });
});
