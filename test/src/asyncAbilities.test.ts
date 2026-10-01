import { beforeEach, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

const EmptyFilter = Symbol.for("drizzle:EmptyFilter");

/**
 * Abilities whose `when()` callback is async. Unlike the post-fetch
 * `filter().prefetch().by()` runtime filters, an async `when()` still returns
 * a declarative `where`, so limits, pagination and counts stay correct.
 */
describe("async abilities", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  let { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id, 50);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;

    const r = makeRumbleSeedInstance(db, data.users.at(0)?.id, 50);
    rumble = r.rumble;
    build = r.build;
  });

  /** resolves on a later tick so a sync implementation can't accidentally pass */
  const later = <T>(value: T) =>
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(value), 5),
    ) as Promise<T>;

  const run = async (query: string) => {
    const { executor } = build();
    return (await executor({ document: parse(query) })) as any;
  };

  describe("when()", () => {
    test("an async when() restricts the result in the database", async () => {
      const allowed = data.users.slice(0, 5).map((u) => u.id);
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: { in: allowed } } };
      });

      const r = await run(`query { users { id } }`);

      expect(r.errors).toBeUndefined();
      expect(r.data.users.map((u: any) => u.id).sort()).toEqual(
        [...allowed].sort(),
      );
    });

    test("an async when() can use the request context", async () => {
      rumble.abilityBuilder.posts.allow("read").when(async ({ userId }) => {
        await later(null);
        return { where: { ownerId: userId } };
      });

      const r = await run(`query { posts { id } }`);

      const expected = data.posts.filter((p) => p.ownerId === data.users[0].id);
      expect(r.data.posts).toHaveLength(Math.min(expected.length, 50));
    });

    test("an async when() resolving to 'allow' is unrestricted", async () => {
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return "allow" as const;
      });

      // 200 users are seeded, the default limit of the test instance is 50
      const r = await run(`query { users(limit: 50) { id } }`);

      expect(r.data.users).toHaveLength(50);
    });

    test("an async when() resolving to undefined allows nothing", async () => {
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return undefined;
      });

      const r = await run(`query { users { id } }`);

      expect(r.data?.users ?? []).toHaveLength(0);
    });

    test("sync and async when() callbacks are OR-combined", async () => {
      const syncIds = data.users.slice(0, 3).map((u) => u.id);
      const asyncIds = data.users.slice(3, 7).map((u) => u.id);
      rumble.abilityBuilder.users
        .allow("read")
        .when(() => ({ where: { id: { in: syncIds } } }));
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: { in: asyncIds } } };
      });

      const r = await run(`query { users { id } }`);

      expect(r.data.users.map((u: any) => u.id).sort()).toEqual(
        [...syncIds, ...asyncIds].sort(),
      );
    });

    test("multiple async when() callbacks run in parallel", async () => {
      const started: number[] = [];
      for (let i = 0; i < 3; i++) {
        rumble.abilityBuilder.users.allow("read").when(async () => {
          started.push(Date.now());
          await later(null);
          return { where: { id: data.users[i].id } };
        });
      }

      const t0 = Date.now();
      const r = await run(`query { users { id } }`);

      expect(r.data.users).toHaveLength(3);
      // all three started before the first one could have finished
      expect(Math.max(...started) - Math.min(...started)).toBeLessThan(5);
      expect(Date.now() - t0).toBeLessThan(500);
    });

    test("a rejecting async when() surfaces as a graphql error", async () => {
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        throw new Error("permission service down");
      });

      const r = await run(`query { users { id } }`);

      expect(r.errors?.length).toBeGreaterThan(0);
      expect(r.data?.users ?? null).toBeNull();
    });
  });

  describe("what post-fetch filters can't do", () => {
    test("limit applies after the async filter, not before", async () => {
      const allowed = data.users.slice(0, 20).map((u) => u.id);
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: { in: allowed } } };
      });

      const r = await run(`query { users(limit: 3) { id } }`);

      // a post-fetch filter would load 3 arbitrary rows and keep ~0 of them
      expect(r.data.users).toHaveLength(3);
      for (const u of r.data.users) expect(allowed).toContain(u.id);
    });

    test("offset pages through the allowed rows only", async () => {
      const allowed = data.users.slice(0, 10).map((u) => u.id);
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: { in: allowed } } };
      });

      const page1 = await run(`query { users(limit: 6, offset: 0) { id } }`);
      const page2 = await run(`query { users(limit: 6, offset: 6) { id } }`);

      expect(page1.data.users).toHaveLength(6);
      expect(page2.data.users).toHaveLength(4);
    });

    test("count queries respect the async filter", async () => {
      const allowed = data.users.slice(0, 7).map((u) => u.id);
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: { in: allowed } } };
      });

      const r = await run(`query { usersCount }`);

      expect(r.errors).toBeUndefined();
      expect(r.data.usersCount).toBe(7);
    });
  });

  describe("relations ", () => {
    test("an async when() on the related table filters nested fields", async () => {
      const owner = data.users[0];
      rumble.abilityBuilder.users.allow("read").when({
        where: { id: owner.id },
      });
      rumble.abilityBuilder.posts.allow("read").when(async () => {
        await later(null);
        return { where: { ownerId: owner.id } };
      });

      const r = await run(`query { users { id posts(limit: 1000) { id } } }`);

      expect(r.errors).toBeUndefined();
      expect(r.data.users).toHaveLength(1);
      const expected = data.posts
        .filter((p) => p.ownerId === owner.id)
        .map((p) => p.id)
        .sort();
      expect(r.data.users[0].posts.map((p: any) => p.id).sort()).toEqual(
        expected,
      );
    });

    test("an async when() on the parent and the child combine", async () => {
      const owner = data.users[0];
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: owner.id } };
      });
      rumble.abilityBuilder.posts.allow("read").when(async () => {
        await later(null);
        return { where: { ownerId: owner.id } };
      });

      const r = await run(`query { users { id posts(limit: 1000) { id } } }`);

      expect(r.errors).toBeUndefined();
      expect(r.data.users).toHaveLength(1);
      expect(r.data.users[0].posts.length).toBe(
        data.posts.filter((p) => p.ownerId === owner.id).length,
      );
    });
  });

  describe("per-request memoization", () => {
    test("an async when() runs once per request even if used by several fields", async () => {
      let calls = 0;
      rumble.abilityBuilder.users.allow("read").when(async () => {
        calls++;
        await later(null);
        return "allow" as const;
      });

      const r = await run(`query { users { id } usersCount }`);

      expect(r.errors).toBeUndefined();
      expect(calls).toBe(1);
    });

    test("separate requests don't share the memoized result", async () => {
      let calls = 0;
      rumble.abilityBuilder.users.allow("read").when(async () => {
        calls++;
        await later(null);
        return "allow" as const;
      });

      await run(`query { users { id } }`);
      await run(`query { users { id } }`);

      expect(calls).toBe(2);
    });
  });

  describe("filter()", () => {
    const ctx = () => ({ userId: "u1" }) as any;

    test("filter() returns a promise", () => {
      rumble.abilityBuilder.users
        .allow("read")
        .when(() => ({ where: { id: "x" } }));
      const abilities = rumble.abilityBuilder._.build()(ctx());

      expect(abilities.users.filter("read")).toBeInstanceOf(Promise);
    });

    test("filter() awaits sync callbacks", async () => {
      rumble.abilityBuilder.users
        .allow("read")
        .when(() => ({ where: { id: "x" } }));
      const abilities = rumble.abilityBuilder._.build()(ctx());

      const f = await abilities.users.filter("read");

      expect(f.query.single.where).toEqual({ id: "x" });
    });

    test("filter() awaits async callbacks", async () => {
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: "from-async" } };
      });
      const abilities = rumble.abilityBuilder._.build()(ctx());

      const f = await abilities.users.filter("read");

      expect(f.query.single.where).toEqual({ id: "from-async" });
    });

    test("the result of filter() supports merge() and sql.where", async () => {
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return { where: { id: "from-async" } };
      });
      const abilities = rumble.abilityBuilder._.build()(ctx());

      const f = await abilities.users.filter("read");
      const merged = f.merge({ limit: 2 });

      expect(merged.query.many.limit).toBe(2);
      expect(merged.sql.where).toBeDefined();
    });

    test("filter() works for unrestricted and blocked tables", async () => {
      rumble.abilityBuilder.users.allow("read");
      const abilities = rumble.abilityBuilder._.build()(ctx());

      const unrestricted = await abilities.users.filter("read");
      const blocked = await abilities.posts.filter("read");

      expect<unknown>(unrestricted.query.single.where).toBe(EmptyFilter);
      expect(blocked.query.single.where).toBeDefined();
    });

    describe("forgetting to await", () => {
      const forgotten = () => {
        rumble.abilityBuilder.users
          .allow("read")
          .when(() => ({ where: { id: "x" } }));
        const abilities = (rumble.abilityBuilder as any)._.build()(ctx());
        return abilities.users.filter("read");
      };

      test("accessing query throws a helpful error", () => {
        const f = forgotten();
        expect(() => f.query.single).toThrow(/forget to await/);
      });

      test("accessing sql throws a helpful error", () => {
        const f = forgotten();
        expect(() => f.sql.where).toThrow(/forget to await/);
      });

      test("calling merge throws a helpful error", () => {
        const f = forgotten();
        expect(() => f.merge({})).toThrow(/forget to await/);
      });

      test("spreading the promise into a query throws instead of dropping the filter", () => {
        const f = forgotten();
        expect(() => ({ ...f })).toThrow(/forget to await/);
      });

      test("awaiting still works", async () => {
        const f = await forgotten();
        expect(f.query.single.where).toEqual({ id: "x" });
      });
    });

    test("a rejecting callback rejects filter()", async () => {
      rumble.abilityBuilder.users.allow("read").when(async () => {
        throw new Error("boom");
      });
      const abilities = rumble.abilityBuilder._.build()(ctx());

      await expect(abilities.users.filter("read")).rejects.toThrow("boom");
    });
  });

  describe("telemetry", () => {
    test("the abilities span ends after the async callbacks settle", async () => {
      // asserted in telemetry tests once the span wiring exists; here we only
      // make sure an async ability doesn't leave the request hanging
      rumble.abilityBuilder.users.allow("read").when(async () => {
        await later(null);
        return "allow" as const;
      });

      const r = await run(`query { users(limit: 1) { id } }`);

      expect(r.data.users).toHaveLength(1);
    });
  });
});
