import { beforeEach, describe, expect, test } from "bun:test";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

/**
 * Regression tests for a bug where a table left "unrestricted" (i.e.
 * `allow("read")` with no `.when(...)` clause) produced a query filter
 * object with an explicit `where: undefined` property.
 *
 * Some drizzle-orm versions treat a *present* `where` key with an
 * `undefined` value differently from a `where` key holding drizzle-orm's own
 * `EmptyFilter` sentinel: when such an object is used as a nested relational
 * `with.<relation>` config (which happens automatically whenever a GraphQL
 * query selects a relation without passing an explicit `where` argument),
 * drizzle-orm throws on the former:
 *
 *   "Unexpected 'undefined' in filter value. Use 'EmptyFilter' if you want
 *   the filter field to be skipped."
 *
 * drizzle-orm defines `EmptyFilter` via `Symbol.for("drizzle:EmptyFilter")`,
 * a globally registered symbol, so `Symbol.for` with the same key here
 * yields the identical value without needing to import it — that's also
 * what rumble itself does internally (some supported drizzle-orm versions
 * don't export it as a named export at all).
 *
 * These tests assert on the shape of the filter object rumble hands back,
 * independent of whether the locally installed drizzle-orm version is
 * strict enough to surface the crash itself.
 */
const EmptyFilter = Symbol.for("drizzle:EmptyFilter");
describe("unrestricted ability query filter shape", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  let { rumble } = makeRumbleSeedInstance(db, data.users.at(0)?.id);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;

    const r = makeRumbleSeedInstance(db, data.users.at(0)?.id);
    rumble = r.rumble;
  });

  test("unrestricted table's query filter uses EmptyFilter, never undefined", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

    const abilities = (rumble.abilityBuilder as any)._.build()({
      userId: data.users[0].id,
    });

    const single = abilities.users.filter("read").query.single;
    const many = abilities.users.filter("read").query.many;

    expect(single.where).toBe(EmptyFilter);
    expect(many.where).toBe(EmptyFilter);
  });

  test("merging an unrestricted filter with no explicit where keeps EmptyFilter", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

    const abilities = (rumble.abilityBuilder as any)._.build()({
      userId: data.users[0].id,
    });

    // mirrors how rumble auto-builds a nested relation's `with.<relation>`
    // config when the GraphQL selection passes no `where` argument
    const merged = abilities.users
      .filter("read")
      .merge({ where: undefined, limit: undefined, extras: undefined });

    expect(merged.query.single.where).toBe(EmptyFilter);
    expect(merged.query.many.where).toBe(EmptyFilter);
  });

  test("merging an unrestricted filter with an explicit where still applies it", async () => {
    rumble.abilityBuilder.users.allow(["read"]);

    const abilities = (rumble.abilityBuilder as any)._.build()({
      userId: data.users[0].id,
    });

    const merged = abilities.users.filter("read").merge({
      where: { id: data.users[0].id },
    });

    expect(merged.query.single.where).toEqual({ id: data.users[0].id });
  });

  test("a restricted (blocked) table still produces a concrete `where`, never undefined", async () => {
    // no `.allow(...)` call at all for posts -> nothing registered -> blocked
    const abilities = (rumble.abilityBuilder as any)._.build()({
      userId: data.users[0].id,
    });

    const single = abilities.posts.filter("read").query.single;
    expect(single.where).toBeDefined();
  });
});
