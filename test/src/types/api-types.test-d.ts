/**
 * Type-level tests for the rumble public builder API.
 *
 * These assertions are checked by `tsc --noEmit` (run via
 * `bun run typecheck` or `bun run typecheck:types`). No runtime
 * code path executes them; the goal is to fail the build when
 * the inferred types of `rumble(...)` and its helpers drift.
 *
 * Marking a known-broken case:
 *
 *   // @ts-expect-error TYPE-BROKEN: <short reason / link>
 *   expectTypeOf<...>().toEqualTypeOf<...>();
 *
 * `bun run report:type-broken` greps the repo for `TYPE-BROKEN`
 * markers and prints a report so they don't get silently forgotten.
 */

import { drizzle } from "drizzle-orm/bun-sqlite";
import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import { expectTypeOf } from "expect-type";
import { rumble } from "../../../lib";
import { relations } from "../db/relations";
import * as schema from "../db/schema";

// ---------------------------------------------------------------------------
// Fixture: a typed rumble instance over the test schema. Nothing runs.
// ---------------------------------------------------------------------------

declare const ctxArg: never;

const db = drizzle(":memory:", { relations, schema });

const r = rumble({
  db,
  schema,
  context(_req: Request) {
    return { userId: "u1" };
  },
});

// ---------------------------------------------------------------------------
// rumble() return shape
// ---------------------------------------------------------------------------

expectTypeOf(r).toHaveProperty("abilityBuilder");
expectTypeOf(r).toHaveProperty("schemaBuilder");
expectTypeOf(r).toHaveProperty("object");
expectTypeOf(r).toHaveProperty("query");
expectTypeOf(r).toHaveProperty("whereArg");
expectTypeOf(r).toHaveProperty("orderArg");
expectTypeOf(r).toHaveProperty("pubsub");
expectTypeOf(r).toHaveProperty("enum_");
expectTypeOf(r).toHaveProperty("countQuery");
expectTypeOf(r).toHaveProperty("createYoga");
expectTypeOf(r).toHaveProperty("createSofa");
expectTypeOf(r).toHaveProperty("createWs");
expectTypeOf(r).toHaveProperty("clientCreator");
expectTypeOf(r).toHaveProperty("buildSchema");

// ---------------------------------------------------------------------------
// abilityBuilder: one entry per drizzle table, each with allow/filter
// ---------------------------------------------------------------------------

// Each declared table is exposed.
expectTypeOf(r.abilityBuilder).toHaveProperty("users");
expectTypeOf(r.abilityBuilder).toHaveProperty("posts");
expectTypeOf(r.abilityBuilder).toHaveProperty("comments");

// Tables we never declared must not appear.
expectTypeOf<keyof typeof r.abilityBuilder>().not.toEqualTypeOf<
  "users" | "posts" | "comments" | "nonexistentTable"
>();

// allow/filter chain entry points exist on each table builder.
expectTypeOf(r.abilityBuilder.users.allow).toBeFunction();
expectTypeOf(r.abilityBuilder.users.filter).toBeFunction();

// `allow()` returns a `.when()` chainable.
const allowChain = r.abilityBuilder.users.allow("read");
expectTypeOf(allowChain).toHaveProperty("when");
expectTypeOf(allowChain.when).toBeFunction();

// Default action union is "read" | "update" | "delete" — narrower must error.
r.abilityBuilder.users.allow("read");
r.abilityBuilder.users.allow("update");
r.abilityBuilder.users.allow("delete");
r.abilityBuilder.users.allow(["read", "update"]);

// @ts-expect-error invalid action token must be a type error
r.abilityBuilder.users.allow("definitelyNotAnAction");

// `.when(staticObj)` accepts a drizzle relations filter shape.
r.abilityBuilder.users.allow("read").when({ where: { id: "u1" } });

// `.when(fn)` receives the user context typed from `rumble({ context })`.
r.abilityBuilder.users.allow("read").when((ctx) => {
  expectTypeOf(ctx).toEqualTypeOf<{ userId: string }>();
  return { where: { id: ctx.userId } };
});

// ---------------------------------------------------------------------------
// pubsub: returns the three action callbacks
// ---------------------------------------------------------------------------

const ps = r.pubsub({ table: "users" });
expectTypeOf(ps).toHaveProperty("created");
expectTypeOf(ps).toHaveProperty("updated");
expectTypeOf(ps).toHaveProperty("removed");
expectTypeOf(ps.created).toBeFunction();
expectTypeOf(ps.updated).toBeFunction();
expectTypeOf(ps.removed).toBeFunction();

// @ts-expect-error nonexistent table must fail
r.pubsub({ table: "notARealTable" });

// ---------------------------------------------------------------------------
// query helper: bad table rejected
// ---------------------------------------------------------------------------

r.query({ table: "users" });
// @ts-expect-error nonexistent table must fail
r.query({ table: "notATable" });

// ---------------------------------------------------------------------------
// object helper: bad table rejected, refName is optional string
// ---------------------------------------------------------------------------

r.object({ table: "users" });
r.object({ table: "users", refName: "User" });

// @ts-expect-error nonexistent table must fail
r.object({ table: "notATable" });

// ---------------------------------------------------------------------------
// ctx.abilities surface (via the resolver shape on a drizzleField)
// ---------------------------------------------------------------------------

r.schemaBuilder.queryFields((t) => ({
  probe: t.drizzleField({
    type: r.object({ table: "users" }),
    resolve: async (_query, _root, _args, ctx, _info) => {
      // User context fields are preserved.
      expectTypeOf(ctx).toHaveProperty("userId");
      expectTypeOf(ctx.userId).toEqualTypeOf<string>();

      // abilities is keyed by table name.
      expectTypeOf(ctx.abilities).toHaveProperty("users");
      expectTypeOf(ctx.abilities).toHaveProperty("posts");
      expectTypeOf(ctx.abilities).toHaveProperty("comments");

      // filter("read") returns a `{ query: { many, single }, sql, merge }` shape.
      const f = ctx.abilities.users.filter("read");
      expectTypeOf(f).toHaveProperty("query");
      expectTypeOf(f).toHaveProperty("sql");
      expectTypeOf(f).toHaveProperty("merge");
      expectTypeOf(f.query).toHaveProperty("many");
      expectTypeOf(f.query).toHaveProperty("single");
      expectTypeOf(f.sql).toHaveProperty("where");

      // .merge({ where }) preserves the same shape.
      const merged = f.merge({ where: { id: "u1" } });
      expectTypeOf(merged).toHaveProperty("query");
      expectTypeOf(merged.query).toHaveProperty("many");

      // unreachable at runtime
      throw new Error("type-only");
    },
  }),
}));

// ---------------------------------------------------------------------------
// Custom Action union widens the allow() input
// ---------------------------------------------------------------------------

const r2 = rumble({
  db,
  schema,
  actions: ["read", "publish"] as const as Array<"read" | "publish">,
  context() {
    return {};
  },
});

r2.abilityBuilder.posts.allow("read");
r2.abilityBuilder.posts.allow("publish");
// @ts-expect-error "delete" is not in the custom action set
r2.abilityBuilder.posts.allow("delete");

// ---------------------------------------------------------------------------
// enum_ helper: the returned GraphQL enum ref is strongly typed, with the
// member union derived from the drizzle enum definition.
// ---------------------------------------------------------------------------

// Recover the member shape carried by a Pothos enum ref.
type EnumShapeOf<R> =
  R extends PothosSchemaTypes.EnumRef<any, infer T, any> ? T : never;

const moodEnum = pgEnum("mood_native", ["sad", "ok", "happy"]);
// Object-enum form: drizzle widens the values to `string` unless they are
// `as const`, so the literal union is only recoverable in the const case.
const objectEnum = pgEnum("object_native", {
  Draft: "draft",
  Published: "published",
} as const);
const things = pgTable("things_table", {
  mood: moodEnum(),
});

// `enum`: array form keeps the literal union.
const moodRef = r.enum_({ enum: moodEnum });
expectTypeOf<EnumShapeOf<typeof moodRef>>().toEqualTypeOf<
  "sad" | "ok" | "happy"
>();
// ...and is genuinely narrowed (not widened to `string`/`any`).
expectTypeOf<EnumShapeOf<typeof moodRef>>().not.toEqualTypeOf<string>();

// `enum`: object form recovers the union from the object's value types.
const objectRef = r.enum_({ enum: objectEnum });
expectTypeOf<EnumShapeOf<typeof objectRef>>().toEqualTypeOf<
  "draft" | "published"
>();

// `enumColumn`: union recovered from the column's `enumValues` tuple.
const columnRef = r.enum_({ enumColumn: things.mood });
expectTypeOf<EnumShapeOf<typeof columnRef>>().toEqualTypeOf<
  "sad" | "ok" | "happy"
>();

// ---------------------------------------------------------------------------
// Known-broken cases live below this line, each tagged TYPE-BROKEN.
// `bun run report:type-broken` enumerates them.
// ---------------------------------------------------------------------------

// (none currently)
