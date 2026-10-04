import { beforeEach, describe, expect, test } from "bun:test";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { parse } from "graphql";
import { rumble } from "../../lib";

// the primary key's database name differs from its ts name
describe("primary keys with a differing database name", () => {
  const accounts = sqliteTable("accounts_pk_name_test", {
    accountId: text("account_id").primaryKey(),
    name: text(),
  });

  const schemaModule = { accounts };
  const relations = defineRelations(schemaModule, () => ({ accounts: {} }));

  let db: ReturnType<typeof drizzle<typeof relations>>;

  beforeEach(() => {
    db = drizzle(":memory:", { relations });
    db.run(
      `create table accounts_pk_name_test (account_id text primary key, name text)`,
    );
    db.run(
      `insert into accounts_pk_name_test (account_id, name) values ('a', 'first')`,
    );
  });

  test("a table without abilities returns no rows instead of failing", async () => {
    const r = rumble({ db, schema: schemaModule, context: () => ({}) });
    r.object({ table: "accounts" });
    r.query({ table: "accounts" });

    const executor = buildHTTPExecutor({
      fetch: r.createYoga().fetch,
      endpoint: "http://yoga/graphql",
    });
    const result: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          accounts {
            accountId
          }
        }
      `),
    });

    expect(result.errors).toBeUndefined();
    expect(result.data.accounts).toEqual([]);
  });
});
