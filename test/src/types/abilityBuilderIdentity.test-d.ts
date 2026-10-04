/**
 * Asserts that the ability builder's inferred public types are *identical*
 * to the frozen pre-refactor implementation in ./legacyAbilityBuilder.ts.
 * Identity (not assignability) catches widened, narrowed or `any`-leaking
 * types anywhere in the builder, its built abilities and filter responses.
 */

import { defineRelations } from "drizzle-orm";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import * as pg from "drizzle-orm/pg-core";
import { expectTypeOf } from "expect-type";
import type { AbilityBuilderType } from "../../../lib/abilityBuilder";
import type { CustomRumblePothosConfig } from "../../../lib/types/rumbleInput";
import type { DB as SqliteDB } from "../db/db";
import type { LegacyAbilityBuilderType } from "./legacyAbilityBuilder";

type Ctx = { userId: string; roles: string[] };
type Actions = "read" | "update" | "delete" | "publish";

// sqlite test schema
expectTypeOf<
  AbilityBuilderType<Ctx, SqliteDB, Request, Actions, CustomRumblePothosConfig>
>().toEqualTypeOf<
  LegacyAbilityBuilderType<
    Ctx,
    SqliteDB,
    Request,
    Actions,
    CustomRumblePothosConfig
  >
>();

// a postgres schema with differently typed primary keys and relations
const orgs = pg.pgTable("orgs", {
  id: pg.serial().primaryKey(),
  name: pg.text().notNull(),
});
const members = pg.pgTable("members", {
  id: pg.uuid().primaryKey(),
  orgId: pg.integer().references(() => orgs.id),
  joined: pg.timestamp().notNull(),
});
const pgRelations = defineRelations({ orgs, members }, (r) => ({
  orgs: { members: r.many.members() },
  members: {
    org: r.one.orgs({ from: r.members.orgId, to: r.orgs.id }),
  },
}));
const pgDb = pgDrizzle("postgres://", { relations: pgRelations });
type PgDB = typeof pgDb;

expectTypeOf<
  AbilityBuilderType<Ctx, PgDB, Request, Actions, CustomRumblePothosConfig>
>().toEqualTypeOf<
  LegacyAbilityBuilderType<
    Ctx,
    PgDB,
    Request,
    Actions,
    CustomRumblePothosConfig
  >
>();

// the loose instantiation internal helpers use
expectTypeOf<AbilityBuilderType<any, SqliteDB, any, any, any>>().toEqualTypeOf<
  LegacyAbilityBuilderType<any, SqliteDB, any, any, any>
>();

// built abilities and filter responses, spelled out so a failure points at
// the part that drifted instead of one giant diff
type Built<T extends { _: { build: () => (ctx: any) => any } }> = ReturnType<
  ReturnType<T["_"]["build"]>
>;
type NewBuilder = AbilityBuilderType<
  Ctx,
  SqliteDB,
  Request,
  Actions,
  CustomRumblePothosConfig
>;
type OldBuilder = LegacyAbilityBuilderType<
  Ctx,
  SqliteDB,
  Request,
  Actions,
  CustomRumblePothosConfig
>;

expectTypeOf<NewBuilder["users"]>().toEqualTypeOf<OldBuilder["users"]>();
expectTypeOf<NewBuilder["users"]["allow"]>().toEqualTypeOf<
  OldBuilder["users"]["allow"]
>();
expectTypeOf<NewBuilder["users"]["filter"]>().toEqualTypeOf<
  OldBuilder["users"]["filter"]
>();
expectTypeOf<NewBuilder["_"]>().toEqualTypeOf<OldBuilder["_"]>();
expectTypeOf<Built<NewBuilder>>().toEqualTypeOf<Built<OldBuilder>>();
expectTypeOf<
  Awaited<ReturnType<Built<NewBuilder>["posts"]["filter"]>>
>().toEqualTypeOf<Awaited<ReturnType<Built<OldBuilder>["posts"]["filter"]>>>();
expectTypeOf<
  ReturnType<Awaited<ReturnType<Built<NewBuilder>["posts"]["filter"]>>["merge"]>
>().toEqualTypeOf<
  ReturnType<Awaited<ReturnType<Built<OldBuilder>["posts"]["filter"]>>["merge"]>
>();

// guard against the identity checks above passing trivially
expectTypeOf<NewBuilder>().not.toBeAny();
expectTypeOf<NewBuilder>().not.toEqualTypeOf<
  LegacyAbilityBuilderType<
    { userId: number },
    SqliteDB,
    Request,
    Actions,
    CustomRumblePothosConfig
  >
>();
expectTypeOf<NewBuilder>().not.toEqualTypeOf<
  LegacyAbilityBuilderType<
    Ctx,
    SqliteDB,
    Request,
    "read" | "update",
    CustomRumblePothosConfig
  >
>();
