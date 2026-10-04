import { beforeEach, describe, expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { RumbleError, rumble } from "../../lib";
import { type DB, makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";

/**
 * Characterization tests for the ability builder. They talk to the builder
 * directly (instead of through graphql) and pin the exact shape of what
 * `filter()` hands back, so refactors of the builder internals can't
 * silently change behavior.
 */

const EmptyFilter = Symbol.for("drizzle:EmptyFilter");
// global symbols, so the tests don't depend on the builder's file layout
const columnMaskKey = Symbol.for("rumble:columnMask");

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child() {
      return this;
    },
  };
}

function makeInstance(
  db: DB,
  {
    defaultLimit = null,
    logger,
  }: {
    defaultLimit?: number | null;
    logger?: ReturnType<typeof makeLogger>;
  } = {},
) {
  return rumble({
    db,
    schema,
    context: () => ({ userId: "nobody" }),
    defaultLimit,
    logger: logger ? { enabled: true, logger } : undefined,
  });
}

describe("ability builder", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  let r = makeInstance(db);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;
    r = makeInstance(db);
  });

  const self = () => data.users[0]!;
  const abilitiesFor = (userId = self().id) =>
    r.abilityBuilder._.build()({ userId });

  const renderWhere = (where: unknown) =>
    db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(where as any)
      .toSQL();

  describe("registration", () => {
    test("allow() after build throws", () => {
      r.abilityBuilder._.build();
      expect(() => r.abilityBuilder.users.allow("read")).toThrow(RumbleError);
      expect(() => r.abilityBuilder.users.allow("read")).toThrow(
        "You can't call allow() after the ability builder has been built",
      );
    });

    test("allow() with an array registers every action", async () => {
      r.abilityBuilder.users.allow(["read", "update"]);
      const abilities = abilitiesFor();

      expect((await abilities.users.filter("read")).query.many.where).toBe(
        EmptyFilter as any,
      );
      expect((await abilities.users.filter("update")).query.many.where).toBe(
        EmptyFilter as any,
      );
      expect(
        (await abilities.users.filter("delete")).query.many.where,
      ).not.toBe(EmptyFilter as any);
    });

    test("when() chained on allow() replaces the unrestricted default", async () => {
      r.abilityBuilder.users.allow("read").when({ where: { id: "some-id" } });
      const f = await abilitiesFor().users.filter("read");
      expect(f.query.many.where).toEqual({ id: "some-id" });
    });

    test("when() on a separate allow() after a bare allow() is ignored", async () => {
      r.abilityBuilder.users.allow("read");
      r.abilityBuilder.users.allow("read").when({ where: { id: "some-id" } });
      const f = await abilitiesFor().users.filter("read");
      expect(f.query.many.where).toBe(EmptyFilter as any);
    });

    test("a bare allow() after when() keeps the restricted filters", async () => {
      r.abilityBuilder.users.allow("read").when({ where: { id: "some-id" } });
      r.abilityBuilder.users.allow("read");
      const f = await abilitiesFor().users.filter("read");
      expect(f.query.many.where).toEqual({ id: "some-id" });
    });

    test("filter().by() and filter().prefetch().by() register per action", () => {
      const by = () => [];
      const prefetchedBy = () => [];
      const prefetch = async () => 1;
      r.abilityBuilder.users.filter("read").by(by);
      r.abilityBuilder.users
        .filter(["read", "update"])
        .prefetch(prefetch)
        .by(prefetchedBy);

      const read = r.abilityBuilder._.registeredFilters({
        table: "users",
        action: "read",
      }) as any[];
      const update = r.abilityBuilder._.registeredFilters({
        table: "users",
        action: "update",
      }) as any[];
      const del = r.abilityBuilder._.registeredFilters({
        table: "users",
        action: "delete",
      }) as any[];

      expect(read).toEqual([
        { filter: by },
        { filter: prefetchedBy, prefetch },
      ]);
      expect(update).toEqual([{ filter: prefetchedBy, prefetch }]);
      expect(del).toEqual([]);
    });

    test("registered filter arrays are stable references", () => {
      const before = r.abilityBuilder._.registeredFilters({
        table: "posts",
        action: "read",
      });
      r.abilityBuilder.posts.filter("read").by(() => []);
      const after = r.abilityBuilder._.registeredFilters({
        table: "posts",
        action: "read",
      });
      expect(after).toBe(before);
      expect(after.length).toBe(1);
    });

    test("readActionOf defaults to read and honors registered actions", () => {
      expect(r.abilityBuilder._.readActionOf("users")).toBe("read");
      r.abilityBuilder._.registerReadAction("users", "update");
      expect(r.abilityBuilder._.readActionOf("users")).toBe("update");
      expect(r.abilityBuilder._.readActionOf("posts")).toBe("read");
    });

    test("only tables get builders", () => {
      expect(Object.keys(r.abilityBuilder).sort()).toEqual(
        ["_", "comments", "posts", "users"].sort(),
      );
    });
  });

  describe("filter resolution", () => {
    test("unrestricted filter shape", async () => {
      r.abilityBuilder.users.allow("read");
      const f = await abilitiesFor().users.filter("read");

      expect(f.query.single).toEqual({
        extras: undefined,
        where: EmptyFilter,
      } as any);
      expect("columns" in f.query.single).toBe(false);
      expect(f.query.many.where).toBe(EmptyFilter as any);
      expect(f.query.many.limit).toBeUndefined();
      expect(f.sql.where).toBeUndefined();
      expect((f as any)[columnMaskKey]).toBeUndefined();
      expect(typeof f.merge).toBe("function");
    });

    test("nothing registered blocks everything", async () => {
      const f = await abilitiesFor().users.filter("read");
      expect(f.query.many.where).toMatchSnapshot();
      expect(renderWhere(f.sql.where)).toMatchSnapshot();
      expect(await db.query.users.findMany(f.query.many)).toEqual([]);
    });

    test("nothing registered warns once via the logger", async () => {
      const logger = makeLogger();
      r = makeInstance(db, { logger });
      const abilities = abilitiesFor();
      await abilities.users.filter("read");
      await abilities.users.filter("read");
      await abilitiesFor().users.filter("read");
      // debounced
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]).toEqual([
        expect.objectContaining({
          "rumble.table": "users",
          "rumble.action": "read",
        }),
        "No abilities registered for users/read — blocking everything. Register the ability or ignore this warning if intentional.",
      ] as any);
    });

    test("static filter", async () => {
      r.abilityBuilder.users.allow("read").when({ where: { id: self().id } });
      const f = await abilitiesFor().users.filter("read");

      expect(f.query.single).toEqual({
        extras: undefined,
        where: { id: self().id },
      } as any);
      expect(f.query.many.where).toEqual({ id: self().id } as any);
      expect(renderWhere(f.sql.where)).toEqual({
        sql: 'select "id" from "users_table" where "users_table"."id" = ?',
        params: [self().id],
      });
      expect(await db.query.users.findMany(f.query.many)).toEqual([self()]);
    });

    test("dynamic sync and async filters receive the context", async () => {
      const seen: unknown[] = [];
      r.abilityBuilder.users.allow("read").when((ctx) => {
        seen.push(ctx);
        return { where: { id: ctx.userId } };
      });
      r.abilityBuilder.posts.allow("read").when(async (ctx) => {
        seen.push(ctx);
        return { where: { ownerId: ctx.userId } };
      });

      const abilities = abilitiesFor();
      const users = await abilities.users.filter("read");
      const posts = await abilities.posts.filter("read");

      expect(seen).toEqual([{ userId: self().id }, { userId: self().id }]);
      expect(users.query.many.where).toEqual({ id: self().id } as any);
      expect(posts.query.many.where).toEqual({ ownerId: self().id } as any);
    });

    test("a dynamic filter returning undefined grants nothing", async () => {
      r.abilityBuilder.users.allow("read").when(() => undefined);
      const f = await abilitiesFor().users.filter("read");
      expect(await db.query.users.findMany(f.query.many)).toEqual([]);
      expect(f.query.many.where).toMatchSnapshot();
    });

    test("a dynamic filter returning allow overrides every other filter", async () => {
      r.abilityBuilder.users.allow("read").when({ where: { id: self().id } });
      r.abilityBuilder.users.allow("read").when(() => "allow");
      const f = await abilitiesFor().users.filter("read");
      expect(f.query.many.where).toBe(EmptyFilter as any);
      expect(f.sql.where).toBeUndefined();
    });

    test("multiple filters are combined with OR", async () => {
      const [a, b] = data.users;
      r.abilityBuilder.users.allow("read").when({ where: { id: a!.id } });
      r.abilityBuilder.users
        .allow("read")
        .when(() => ({ where: { id: b!.id } }));
      const f = await abilitiesFor().users.filter("read");

      expect(f.query.many.where).toEqual({
        OR: [{ id: a!.id }, { id: b!.id }],
      } as any);
      expect(renderWhere(f.sql.where)).toMatchSnapshot();
      const rows = await db.query.users.findMany(f.query.many);
      expect(rows.map((u) => u.id).sort()).toEqual([a!.id, b!.id].sort());
    });

    test("a filter without where combined with OR drops the where", async () => {
      r.abilityBuilder.users.allow("read").when({ where: { id: self().id } });
      r.abilityBuilder.users.allow("read").when({ limit: 3 });
      const f = await abilitiesFor().users.filter("read");
      expect(f.query.many.where).toBe(EmptyFilter as any);
      expect(f.query.many.limit).toBeUndefined();
    });

    test("a throwing dynamic filter rejects and logs", async () => {
      const logger = makeLogger();
      r = makeInstance(db, { logger });
      r.abilityBuilder.users.allow("read").when(() => {
        throw new Error("boom");
      });
      await expect(abilitiesFor().users.filter("read")).rejects.toThrow("boom");
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]).toEqual([
        expect.objectContaining({
          "rumble.table": "users",
          "rumble.action": "read",
        }),
        "abilities failed",
      ] as any);
    });

    test("prepared abilities are logged with their attributes", async () => {
      const logger = makeLogger();
      r = makeInstance(db, { logger });
      r.abilityBuilder.users.allow("read").when({ where: { id: "a" } });
      r.abilityBuilder.users.allow("read").when(() => ({ where: { id: "b" } }));
      r.abilityBuilder.users.allow("read").when(() => undefined);
      r.abilityBuilder.posts.allow("read");

      const abilities = abilitiesFor();
      await abilities.users.filter("read");
      await abilities.posts.filter("read");
      await abilities.comments.filter("read");

      const prepared = logger.debug.mock.calls
        .filter((c: any[]) => c[1] === "abilities prepared")
        .map((c: any[]) => c[0]);
      expect(prepared).toEqual([
        {
          "rumble.table": "users",
          "rumble.action": "read",
          "rumble.abilities.status": "applied",
          "rumble.abilities.dynamic": 1,
          "rumble.abilities.static": 1,
          "rumble.abilities.total": 2,
        },
        {
          "rumble.table": "posts",
          "rumble.action": "read",
          "rumble.abilities.status": "unrestricted",
        },
        {
          "rumble.table": "comments",
          "rumble.action": "read",
          "rumble.abilities.status": "blocked_everything",
        },
      ]);
    });
  });

  describe("caching", () => {
    test("filters are resolved once per context and action", async () => {
      const calls = mock(() => ({ where: { id: self().id } }));
      r.abilityBuilder.users.allow(["read", "update"]).when(calls);

      const abilities = abilitiesFor();
      const first = abilities.users.filter("read");
      expect(abilities.users.filter("read")).toBe(first);
      await first;
      expect(calls).toHaveBeenCalledTimes(1);

      await abilities.users.filter("update");
      expect(calls).toHaveBeenCalledTimes(2);

      await abilitiesFor().users.filter("read");
      expect(calls).toHaveBeenCalledTimes(3);
    });

    test("forgetting to await filter() throws a helpful error", () => {
      r.abilityBuilder.users.allow("read");
      const pending = abilitiesFor().users.filter("read") as any;
      for (const key of ["query", "sql", "merge"]) {
        expect(() => pending[key]).toThrow(RumbleError);
        expect(() => pending[key]).toThrow("did you forget to await it?");
      }
    });
  });

  describe("limits", () => {
    test("ability limit is used without a default limit", async () => {
      r.abilityBuilder.users.allow("read").when({ limit: 5 });
      const f = await abilitiesFor().users.filter("read");
      expect(f.query.many.limit).toBe(5);
      expect("limit" in f.query.single).toBe(false);
    });

    test("default limit caps the ability limit", async () => {
      r = makeInstance(db, { defaultLimit: 9 });
      r.abilityBuilder.users.allow("read").when({ limit: 50 });
      r.abilityBuilder.posts.allow("read").when({ limit: 3 });
      r.abilityBuilder.comments.allow("read");
      const abilities = abilitiesFor();
      expect((await abilities.users.filter("read")).query.many.limit).toBe(9);
      expect((await abilities.posts.filter("read")).query.many.limit).toBe(3);
      expect((await abilities.comments.filter("read")).query.many.limit).toBe(
        9,
      );
    });

    test("merge() limits", async () => {
      r = makeInstance(db, { defaultLimit: 9 });
      r.abilityBuilder.users.allow("read");
      r.abilityBuilder.posts.allow("read").when({ limit: 4 });
      const abilities = abilitiesFor();
      const users = await abilities.users.filter("read");
      const posts = await abilities.posts.filter("read");

      expect(users.merge({}).query.many.limit).toBe(9);
      expect(users.merge({ limit: 3 }).query.many.limit).toBe(3);
      expect(users.merge({ limit: 50 }).query.many.limit).toBe(9);
      expect(posts.merge({}).query.many.limit).toBe(4);
      expect(posts.merge({ limit: 2 }).query.many.limit).toBe(2);
      expect(posts.merge({ limit: 6 }).query.many.limit).toBe(4);
    });
  });

  describe("merge", () => {
    test("merge() ANDs the wheres and keeps the original untouched", async () => {
      r.abilityBuilder.users.allow("read").when({ where: { id: self().id } });
      const f = await abilitiesFor().users.filter("read");
      const merged = f.merge({ where: { firstName: "x" } });

      expect(merged.query.many.where).toEqual({
        AND: [{ id: self().id }, { firstName: "x" }],
      } as any);
      expect(renderWhere(merged.sql.where)).toMatchSnapshot();
      expect(f.query.many.where).toEqual({ id: self().id } as any);
      expect("merge" in merged).toBe(false);
    });

    test("merge() on an unrestricted filter uses the given where only", async () => {
      r.abilityBuilder.users.allow("read");
      const f = await abilitiesFor().users.filter("read");
      expect(f.merge({ where: { id: "a" } }).query.many.where).toEqual({
        id: "a",
      } as any);
      expect(f.merge({}).query.single.where).toBe(EmptyFilter as any);
    });

    test("merge() keeps the selected columns", async () => {
      r.abilityBuilder.users
        .allow("read")
        .when({ columns: { id: true, email: true } });
      const f = await abilitiesFor().users.filter("read");
      const merged = f.merge({ where: { id: self().id } });
      expect((merged.query.single as any).columns).toEqual({
        id: true,
        email: true,
      });
      expect(renderWhere(merged.sql.where)).toMatchSnapshot();
    });
  });

  describe("columns", () => {
    test("columns of a single unconditional ability", async () => {
      r.abilityBuilder.users
        .allow("read")
        .when({ columns: { id: true, email: true } });
      const f = await abilitiesFor().users.filter("read");

      expect(f.query.single).toEqual({
        extras: {
          __rumble_columns: expect.any(Function),
          __rumble_request: expect.any(Function),
        },
        where: EmptyFilter,
        columns: { id: true, email: true },
      } as any);
      expect((f.query.many as any).columns).toEqual({ id: true, email: true });
      expect(f.sql.where).toBeUndefined();
      // even without conditions a restricted column set yields a mask without
      // conditional groups and a constant flag holding only the action index
      expect((f as any)[columnMaskKey]).toEqual({
        guaranteed: new Set(["id", "email"]),
        conditional: [],
        hiddenPerBits: new Map(),
      });
      const extras = (f.query.many as any).extras;
      expect(
        db
          .select({ flag: extras.__rumble_columns(schema.users) })
          .from(schema.users)
          .toSQL(),
      ).toEqual({ sql: 'select 0 from "users_table"', params: [] });
    });

    test("exclusion style columns", async () => {
      r.abilityBuilder.users.allow("read").when({ columns: { email: false } });
      const f = await abilitiesFor().users.filter("read");
      expect((f.query.single as any).columns).toEqual({
        id: true,
        firstName: true,
        lastName: true,
      });
    });

    test("columns are unioned across unconditional abilities", async () => {
      r.abilityBuilder.users
        .allow("read")
        .when({ columns: { id: true, email: true } });
      r.abilityBuilder.users
        .allow("read")
        .when({ columns: { id: true, firstName: true } });
      const f = await abilitiesFor().users.filter("read");
      expect((f.query.single as any).columns).toEqual({
        id: true,
        email: true,
        firstName: true,
      });
      expect((f as any)[columnMaskKey]).toEqual({
        guaranteed: new Set(["id", "email", "firstName"]),
        conditional: [],
        hiddenPerBits: new Map(),
      });
    });

    test("selecting every column drops the columns key", async () => {
      r.abilityBuilder.users
        .allow("read")
        .when({ columns: { id: true, email: true } });
      r.abilityBuilder.users
        .allow("read")
        .when({ columns: { firstName: true, lastName: true } });
      const f = await abilitiesFor().users.filter("read");
      expect("columns" in f.query.single).toBe(false);
    });

    test("conditional columns produce a mask and a flag extra", async () => {
      r.abilityBuilder.users.allow("read").when(({ userId }) => ({
        where: { id: userId },
      }));
      r.abilityBuilder.users.allow("read").when({
        columns: { id: true, firstName: true },
      });
      const f = await abilitiesFor().users.filter("read");

      expect("columns" in f.query.single).toBe(false);
      const extras = (f.query.many as any).extras;
      expect(Object.keys(extras)).toEqual([
        "__rumble_columns",
        "__rumble_request",
      ]);
      expect(
        db
          .select({ flag: extras.__rumble_columns(schema.users) })
          .from(schema.users)
          .toSQL(),
      ).toMatchSnapshot();

      const mask = (f as any)[columnMaskKey];
      expect(mask.guaranteed).toEqual(new Set(["id", "firstName"]));
      expect(mask.conditional).toEqual([new Set(["email", "lastName"])]);
      expect(mask.hiddenPerBits).toEqual(new Map());
    });

    test("the action index is encoded into the flag", async () => {
      r.abilityBuilder.users.allow("update").when(({ userId }) => ({
        where: { id: userId },
      }));
      r.abilityBuilder.users.allow("update").when({
        columns: { id: true },
      });
      const f = await abilitiesFor().users.filter("update");
      const extras = (f.query.many as any).extras;
      const rows = await db
        .select({
          id: schema.users.id,
          flag: extras.__rumble_columns(schema.users),
        })
        .from(schema.users);
      for (const row of rows) {
        // action index 1 + 3 actions * group bit
        expect(row.flag).toBe(row.id === self().id ? 4 : 1);
      }
    });

    test("abilities with the same extra columns share a group", async () => {
      const [a, b] = data.users;
      r.abilityBuilder.users.allow("read").when({ where: { id: a!.id } });
      r.abilityBuilder.users.allow("read").when({ where: { id: b!.id } });
      r.abilityBuilder.users.allow("read").when({ columns: { id: true } });
      const f = await abilitiesFor().users.filter("read");

      const mask = (f as any)[columnMaskKey];
      expect(mask.conditional).toEqual([
        new Set(["email", "firstName", "lastName"]),
      ]);
      const extras = (f.query.many as any).extras;
      expect(
        db
          .select({ flag: extras.__rumble_columns(schema.users) })
          .from(schema.users)
          .toSQL(),
      ).toMatchSnapshot();
    });

    test("distinct column groups get distinct bits", async () => {
      r.abilityBuilder.users.allow("read").when({
        where: { id: "a" },
        columns: { email: true },
      });
      r.abilityBuilder.users.allow("read").when({
        where: { id: "b" },
        columns: { firstName: true },
      });
      r.abilityBuilder.users.allow("read").when({ columns: { id: true } });
      const f = await abilitiesFor().users.filter("read");
      const mask = (f as any)[columnMaskKey];
      expect(mask.guaranteed).toEqual(new Set(["id"]));
      expect(mask.conditional).toEqual([
        new Set(["email"]),
        new Set(["firstName"]),
      ]);
      expect((f.query.single as any).columns).toEqual({
        email: true,
        firstName: true,
        id: true,
      });
    });

    for (const [name, where] of [
      ["direct", { posts: { title: "x" } }],
      ["AND", { AND: [{ id: "a" }, { posts: { title: "x" } }] }],
      ["OR", { OR: [{ id: "a" }, { posts: { title: "x" } }] }],
      ["NOT", { NOT: { posts: { title: "x" } } }],
    ] as const) {
      test(`relational conditions use an uncorrelated subquery (${name})`, async () => {
        r.abilityBuilder.users.allow("read").when({ where: where as any });
        r.abilityBuilder.users.allow("read").when({ columns: { id: true } });
        const f = await abilitiesFor().users.filter("read");
        const extras = (f.query.many as any).extras;
        const rendered = db
          .select({ flag: extras.__rumble_columns(schema.users) })
          .from(schema.users)
          .toSQL();
        expect(rendered.sql).toContain("rumble_columns_0");
        expect(rendered).toMatchSnapshot();
      });
    }

    test("non relational conditions stay inline", async () => {
      r.abilityBuilder.users
        .allow("read")
        .when({ where: { NOT: { id: "a" } } });
      r.abilityBuilder.users.allow("read").when({ columns: { id: true } });
      const f = await abilitiesFor().users.filter("read");
      const extras = (f.query.many as any).extras;
      const rendered = db
        .select({ flag: extras.__rumble_columns(schema.users) })
        .from(schema.users)
        .toSQL();
      expect(rendered.sql).not.toContain("rumble_columns_0");
    });

    test("too many column groups throw", async () => {
      const columns = [
        "id",
        "text",
        "published",
        "someNumber",
        "postId",
        "ownerId",
      ] as const;
      const subsets: string[][] = [];
      for (let i = 0; i < columns.length; i++) {
        subsets.push([columns[i]!]);
        for (let j = i + 1; j < columns.length; j++) {
          subsets.push([columns[i]!, columns[j]!]);
        }
      }
      for (let i = 0; i < columns.length && subsets.length < 30; i++) {
        for (let j = i + 1; j < columns.length && subsets.length < 30; j++) {
          for (let k = j + 1; k < columns.length && subsets.length < 30; k++) {
            subsets.push([columns[i]!, columns[j]!, columns[k]!]);
          }
        }
      }
      expect(new Set(subsets.map((s) => [...s].sort().join())).size).toBe(30);

      subsets.forEach((subset, i) => {
        r.abilityBuilder.comments.allow("read").when({
          where: { id: `c${i}` },
          columns: Object.fromEntries(subset.map((c) => [c, true])),
        });
      });

      await expect(abilitiesFor().comments.filter("read")).rejects.toThrow(
        "Too many abilities with differing columns on comments/read: 30, at most 29 are supported.",
      );
    });
  });

  describe("maskColumns", () => {
    const registerSelfAndOthers = () => {
      r.abilityBuilder.users.allow("read").when(({ userId }) => ({
        where: { id: userId },
      }));
      r.abilityBuilder.users.allow("read").when({
        columns: { id: true, firstName: true },
      });
    };

    test("hides conditional columns on rows outside the condition", async () => {
      registerSelfAndOthers();
      const abilities = abilitiesFor();
      const f = await abilities.users.filter("read");
      const rows = await db.query.users.findMany(f.query.many as any);

      await r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities,
        entities: rows,
      });

      for (const row of rows as any[]) {
        expect(row.__rumble_columns).toBeUndefined();
        expect(row.id).toBeDefined();
        expect(row.firstName).toBeDefined();
        if (row.id === self().id) {
          expect(row.email).toBe(self().email);
          expect(row.lastName).toBe(self().lastName);
        } else {
          expect(row.email).toBeUndefined();
          expect(row.lastName).toBeUndefined();
        }
      }
    });

    test("masking twice with the same abilities is a no op", async () => {
      registerSelfAndOthers();
      const abilities = abilitiesFor();
      const f = await abilities.users.filter("read");
      const rows = (await db.query.users.findMany(
        f.query.many as any,
      )) as any[];
      const own = rows.find((row) => row.id === self().id);

      r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities,
        entities: rows,
      });
      r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities,
        entities: rows,
      });
      expect(own.email).toBe(self().email);
    });

    test("waits for unresolved abilities", async () => {
      registerSelfAndOthers();
      const rows = (await db.query.users.findMany(
        (
          await abilitiesFor().users.filter("read")
        ).query.many as any,
      )) as any[];

      const fresh = abilitiesFor();
      const result = r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities: fresh,
        entities: [null, ...rows],
      });
      expect(result).toBeInstanceOf(Promise);
      await result;
      const other = rows.find((row) => row.id !== self().id);
      expect(other.email).toBeUndefined();
    });

    test("rows without a flag are reduced to the guaranteed columns of the given action", async () => {
      r.abilityBuilder.users.allow("read").when({ columns: { id: true } });
      const abilities = abilitiesFor();
      await abilities.users.filter("read");
      const row: any = { id: "x", email: "e", firstName: "f" };
      r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities,
        entities: [row],
      });
      expect(row.id).toBe("x");
      expect(row.email).toBeUndefined();
      expect(row.firstName).toBeUndefined();
    });

    test("full rows loaded through the ability aware client are masked", async () => {
      // pothos reloads apply where and extras, but not the ability's columns
      r.abilityBuilder.users.allow("read").when({ columns: { id: true } });
      const abilities = abilitiesFor();
      const f = await abilities.users.filter("read");
      const rows: any[] = await db.query.users.findMany({
        extras: (f.query.many as any).extras,
      });
      expect(rows[0].email).toBeDefined();

      await r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities,
        entities: rows,
      });
      for (const row of rows) {
        expect(row.id).toBeDefined();
        expect(row.email).toBeUndefined();
        expect(row.firstName).toBeUndefined();
      }
    });

    test("the constant flag of an unconditional restriction selects its action", async () => {
      r.abilityBuilder.users.allow("read");
      r.abilityBuilder.users.allow("update").when({ columns: { id: true } });
      const abilities = abilitiesFor();
      const f = await abilities.users.filter("update");
      const rows: any[] = await db.query.users.findMany({
        extras: (f.query.many as any).extras,
      });
      expect(rows[0].__rumble_columns).toBe(1);

      // masked in a read context: the update mask still applies
      await r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities,
        entities: rows,
      });
      for (const row of rows) {
        expect(row.id).toBeDefined();
        expect(row.email).toBeUndefined();
      }
    });

    test("flagged rows resolve the action encoded in the flag", async () => {
      r.abilityBuilder.users.allow("update").when(({ userId }) => ({
        where: { id: userId },
      }));
      r.abilityBuilder.users.allow("update").when({ columns: { id: true } });
      const abilities = abilitiesFor();
      const f = await abilities.users.filter("update");
      const extras = (f.query.many as any).extras;
      const rows: any[] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          __rumble_columns: extras.__rumble_columns(schema.users),
          __rumble_request: extras.__rumble_request(schema.users),
        })
        .from(schema.users);

      // passing "read" which has no abilities: the flag wins
      r.abilityBuilder._.maskColumns({
        table: "users",
        action: "read",
        abilities,
        entities: rows,
      });
      for (const row of rows) {
        expect(row.email === undefined).toBe(row.id !== self().id);
      }
    });
  });

  test("sql where of a flagged query is still usable", async () => {
    r.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { id: userId },
      columns: { id: true, email: true },
    }));
    r.abilityBuilder.users.allow("read").when({
      where: { firstName: { isNotNull: true } },
      columns: { id: true },
    });
    const f = await abilitiesFor().users.filter("read");
    expect(renderWhere(f.sql.where)).toMatchSnapshot();
    const count = await db
      .select({ c: sql<number>`count(*)` })
      .from(schema.users)
      .where(f.sql.where);
    expect(count[0]!.c).toBeGreaterThan(0);
  });
});
