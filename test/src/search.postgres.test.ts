import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineRelations, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as pg from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { rumble as makeRumble } from "../../lib";
import type { ObjectSearchConfig } from "../../lib/search";

/**
 * Search on Postgres, the only dialect it supports. Runs only with
 * `RUMBLE_TEST_DATABASE_URL` set, e.g. against the dev compose database:
 *
 *   RUMBLE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bun test search
 *
 * Everything is created in, and dropped with, its own schema.
 */

const DATABASE_URL = process.env.RUMBLE_TEST_DATABASE_URL;
const SCHEMA_NAME = "rumble_test_search";

describe.skipIf(!DATABASE_URL)("search on Postgres", () => {
  const pgSchema = pg.pgSchema(SCHEMA_NAME);
  const author = pgSchema.table("author", {
    id: pg.text().primaryKey(),
    name: pg.text().notNull(),
    bio: pg.text(),
  });
  const book = pgSchema.table("book", {
    id: pg.text().primaryKey(),
    title: pg.text().notNull(),
    blurb: pg.text(),
    authorId: pg.text().notNull(),
  });
  const schema = { author, book };
  const relations = defineRelations(schema, (r) => ({
    book: {
      author: r.one.author({
        from: r.book.authorId,
        to: r.author.id,
        optional: false,
      }),
    },
    author: {
      books: r.many.book({ from: r.author.id, to: r.book.authorId }),
    },
  }));

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle({ client: pool, relations });

  /** A fresh instance, since a table's search setting is fixed once its object exists. */
  function makeInstance({
    authorSearch,
    bookSearch,
    authorColumns,
  }: {
    authorSearch?: ObjectSearchConfig<"id" | "name" | "bio">;
    bookSearch?: ObjectSearchConfig<"id" | "title" | "blurb" | "authorId">;
    /** the author columns the caller may read; all without */
    authorColumns?: Partial<Record<"id" | "name" | "bio", true>>;
  } = {}) {
    const r = makeRumble({
      db,
      schema,
      context: () => ({}),
      search: { enabled: true },
    });
    if (authorColumns) {
      r.abilityBuilder.author.allow("read").when({ columns: authorColumns });
    } else {
      r.abilityBuilder.author.allow("read");
    }
    r.abilityBuilder.book.allow("read");
    r.object({ table: "author", search: authorSearch });
    r.object({ table: "book", search: bookSearch });
    r.query({ table: "author" });
    r.query({ table: "book" });
    const yoga = r.createYoga();

    return async (document: string, variables: Record<string, unknown>) => {
      const response = await yoga.fetch("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: document, variables }),
      });
      return (await response.json()) as any;
    };
  }

  const BOOKS = /* GraphQL */ `
    query ($search: String) {
      books(search: $search) {
        id
      }
    }
  `;
  const AUTHORS = /* GraphQL */ `
    query ($search: String) {
      authors(search: $search) {
        id
      }
    }
  `;

  beforeAll(async () => {
    await db.execute(sql`create extension if not exists pg_trgm`);
    await db.execute(sql.raw(`drop schema if exists "${SCHEMA_NAME}" cascade`));
    await db.execute(sql.raw(`create schema "${SCHEMA_NAME}"`));
    await db.execute(
      sql.raw(
        `create table "${SCHEMA_NAME}"."author" ("id" text primary key, "name" text not null, "bio" text)`,
      ),
    );
    await db.execute(
      sql.raw(
        `create table "${SCHEMA_NAME}"."book" ("id" text primary key, "title" text not null, "blurb" text, "authorId" text not null)`,
      ),
    );
    await db.insert(author).values([
      { id: "a1", name: "Ursula Le Guin", bio: "Wrote about anarchist moons" },
      { id: "a2", name: "Terry Pratchett", bio: "Wrote about a flat world" },
    ]);
    await db.insert(book).values([
      {
        id: "b1",
        title: "The Dispossessed",
        blurb: "An anarchist moon",
        authorId: "a1",
      },
      {
        id: "b2",
        title: "The Left Hand of Darkness",
        blurb: "Small gods of winter",
        authorId: "a1",
      },
      {
        id: "b3",
        title: "Small Gods",
        blurb: "A tortoise and a prophet",
        authorId: "a2",
      },
    ]);
  });

  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists "${SCHEMA_NAME}" cascade`));
    await pool.end();
  });

  test("ranks the closest match first", async () => {
    const result = await makeInstance()(BOOKS, { search: "The Dispossessed" });

    expect(result.errors).toBeUndefined();
    expect(result.data.books[0].id).toEqual("b1");
  });

  // with a relation in the selection, drizzle orders and limits in a subquery
  // that selects only the table's columns: ordering by the `search_distance`
  // alias failed there
  test("works with a relation and a limit in the selection", async () => {
    const result = await makeInstance()(
      /* GraphQL */ `
        query ($search: String) {
          books(search: $search, limit: 2) {
            id
            author {
              name
            }
          }
        }
      `,
      { search: "Small Gods" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data.books[0]).toEqual({
      id: "b3",
      author: { name: "Terry Pratchett" },
    });
  });

  describe("the columns an object names", () => {
    test("a term only an unnamed column holds finds nothing", async () => {
      const everyColumn = await makeInstance()(BOOKS, {
        search: "A tortoise and a prophet",
      });
      expect(everyColumn.data.books.map((b: any) => b.id)).toContain("b3");

      const titleOnly = await makeInstance({
        bookSearch: { columns: ["title"] },
      })(BOOKS, { search: "A tortoise and a prophet" });

      expect(titleOnly.errors).toBeUndefined();
      expect(titleOnly.data.books).toEqual([]);
    });

    test("only the named columns count for the ranking", async () => {
      // "Small gods" is b2's blurb and b3's title: by every column b2 also
      // matches, by the title alone only b3 does
      const everyColumn = await makeInstance()(BOOKS, { search: "Small Gods" });
      expect(everyColumn.data.books.map((b: any) => b.id)).toContain("b2");

      const titleOnly = await makeInstance({
        bookSearch: { columns: ["title"] },
      })(BOOKS, { search: "Small Gods" });

      expect(titleOnly.errors).toBeUndefined();
      expect(titleOnly.data.books.map((b: any) => b.id)).toEqual(["b3"]);
    });

    test("apply to the relation fields leading to the table", async () => {
      const result = await makeInstance({
        bookSearch: { columns: ["title"] },
      })(
        /* GraphQL */ `
          query ($search: String) {
            authors {
              id
              books(search: $search) {
                id
              }
            }
          }
        `,
        { search: "An anarchist moon" },
      );

      expect(result.errors).toBeUndefined();
      expect(result.data.authors).toHaveLength(2);
      for (const a of result.data.authors) expect(a.books).toEqual([]);
    });

    test("leave out a column the caller may not read", async () => {
      const run = makeInstance({
        authorSearch: { columns: ["name", "bio"] },
        authorColumns: { id: true, name: true },
      });

      const byBio = await run(AUTHORS, { search: "Wrote about a flat world" });
      expect(byBio.errors).toBeUndefined();
      expect(byBio.data.authors).toEqual([]);

      const byName = await run(AUTHORS, { search: "Terry Pratchett" });
      expect(byName.data.authors.map((a: any) => a.id)).toEqual(["a2"]);
    });

    test("none of which the caller may read find no rows, not every row", async () => {
      const result = await makeInstance({
        authorSearch: { columns: ["bio"] },
        authorColumns: { id: true, name: true },
      })(AUTHORS, { search: "Wrote about a flat world" });

      expect(result.errors).toBeUndefined();
      expect(result.data.authors).toEqual([]);
    });
  });
});
