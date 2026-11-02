import { beforeEach, describe, expect, mock, test } from "bun:test";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { eq } from "drizzle-orm";
import { parse } from "graphql";
import { refreshAbilities, rumble } from "../../lib";
import { type DB, makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";

/**
 * `resolveRelationalRules`: relational rules are looked up once per request
 * and replaced by the primary keys they match, see `statementSize.test.ts`
 * for why.
 */

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

type Context = { userId: string };

function makeInstance(
  db: DB,
  {
    enabled = true,
    maxIds,
    logger,
  }: {
    enabled?: boolean;
    maxIds?: number;
    logger?: ReturnType<typeof makeLogger>;
  } = {},
) {
  return rumble({
    db,
    schema,
    context: (): Context => ({ userId: "nobody" }),
    defaultLimit: null,
    resolveRelationalRules: { enabled, maxIds },
    logger: logger ? { enabled: true, logger } : undefined,
  });
}

/** The attributes of the "abilities prepared" log lines. */
const prepared = (logger: ReturnType<typeof makeLogger>) =>
  logger.debug.mock.calls
    .filter((c: any[]) => c[1] === "abilities prepared")
    .map((c: any[]) => c[0]);

describe("resolving relational rules to primary keys", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;
  });

  const post = () => data.posts[0]!;
  const owner = () => data.users.find((u) => u.id === post().ownerId)!;

  test("a relational rule becomes the list of primary keys it matches", async () => {
    const r = makeInstance(db);
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { id: post().id } },
    });
    const abilities = r.abilityBuilder._.build()({ userId: owner().id });
    const f = await abilities.users.filter("read");

    expect(f.query.many.where).toEqual({ id: { in: [owner().id] } });
    const rows = await db.query.users.findMany(f.query.many);
    expect(rows.map((u) => u.id)).toEqual([owner().id]);
  });

  test("rules matching more rows than maxIds stay relational", async () => {
    const r = makeInstance(db, { maxIds: 1 });
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { title: { isNotNull: true } } },
    });
    const abilities = r.abilityBuilder._.build()({ userId: owner().id });
    const f = await abilities.users.filter("read");

    expect(f.query.many.where).toEqual({
      posts: { title: { isNotNull: true } },
    });
  });

  test("a rule matching no row grants nothing", async () => {
    const r = makeInstance(db);
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { id: "no such post" } },
    });
    const abilities = r.abilityBuilder._.build()({ userId: owner().id });
    const f = await abilities.users.filter("read");

    expect(await db.query.users.findMany(f.query.many)).toEqual([]);
  });

  test("non relational rules and the lookup count are reported, not resolved", async () => {
    const logger = makeLogger();
    const r = makeInstance(db, { logger });
    r.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { id: userId },
    }));
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { id: post().id } },
    });
    const abilities = r.abilityBuilder._.build()({ userId: "someone" });
    const f = await abilities.users.filter("read");

    // static rules come first
    expect(f.query.many.where).toEqual({
      OR: [{ id: { in: [owner().id] } }, { id: "someone" }],
    });
    expect(prepared(logger)).toEqual([
      expect.objectContaining({
        "rumble.table": "users",
        "rumble.abilities.total": 2,
        "rumble.abilities.resolved": 1,
      }),
    ]);
  });

  test("disabled, rules stay relational and nothing is reported", async () => {
    const logger = makeLogger();
    const r = makeInstance(db, { enabled: false, logger });
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { id: post().id } },
    });
    const abilities = r.abilityBuilder._.build()({ userId: "someone" });
    const f = await abilities.users.filter("read");

    expect(f.query.many.where).toEqual({ posts: { id: post().id } });
    expect(prepared(logger)[0]).not.toHaveProperty("rumble.abilities.resolved");
  });

  test("the lists are a snapshot until a root field resolves again", async () => {
    const r = makeInstance(db);
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { id: post().id } },
    });
    const abilities = r.abilityBuilder._.build()({ userId: "someone" });
    expect((await abilities.users.filter("read")).query.many.where).toEqual({
      id: { in: [owner().id] },
    });

    const newOwner = data.users.find((u) => u.id !== owner().id)!;
    await db
      .update(schema.posts)
      .set({ ownerId: newOwner.id })
      .where(eq(schema.posts.id, post().id));

    // within the request the snapshot stands
    expect((await abilities.users.filter("read")).query.many.where).toEqual({
      id: { in: [owner().id] },
    });
    // a root field resolving (a live query refetching) starts over
    refreshAbilities(abilities);
    expect((await abilities.users.filter("read")).query.many.where).toEqual({
      id: { in: [newOwner.id] },
    });
  });

  test("the sql where for writes uses the list", async () => {
    const r = makeInstance(db);
    r.abilityBuilder.users.allow("update").when({
      where: { posts: { id: post().id } },
    });
    const abilities = r.abilityBuilder._.build()({ userId: "someone" });
    const f = await abilities.users.filter("update");
    const rendered = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(f.sql.where)
      .toSQL();

    expect(rendered.sql).toContain(`"users_table"."id" in (?)`);
    expect(rendered.sql).not.toContain("exists");
    expect(rendered.params).toEqual([owner().id]);
  });

  test("column flags check the list instead of the relation", async () => {
    const r = makeInstance(db);
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { id: post().id } },
      columns: { id: true, email: true },
    });
    r.abilityBuilder.users.allow("read").when({
      columns: { id: true, firstName: true },
    });
    const abilities = r.abilityBuilder._.build()({ userId: "someone" });
    const f = await abilities.users.filter("read");
    const extras = (f.query.many as any).extras;
    const flag = db
      .select({ flag: extras.__rumble_columns_0(schema.users) })
      .from(schema.users)
      .toSQL();
    expect(flag.sql).not.toContain("exists");
    expect(flag.sql).toContain(`"users_table"."id" in (?)`);

    const rows: any[] = await db.query.users.findMany(f.query.many);
    expect(rows).toHaveLength(data.users.length);
    for (const row of rows) {
      expect(row.__rumble_columns_0).toEqual(row.id === owner().id ? 1 : 0);
    }
  });

  test("every root field starts a new snapshot, mutations included", async () => {
    const r = makeInstance(db);
    const marker = `marked-${Math.random()}`;
    // readable: the owners of posts titled with the marker
    r.abilityBuilder.users.allow("read").when({
      where: { posts: { title: marker } },
    });
    r.abilityBuilder.posts.allow("read");
    r.abilityBuilder.comments.allow("read");
    r.object({ table: "users", refName: "User" });
    r.object({ table: "posts", refName: "Post" });
    r.object({ table: "comments", refName: "Comment" });
    r.query({ table: "users" });

    const newOwner = data.users[5]!;
    r.schemaBuilder.mutationFields((t) => ({
      // resolves the user rules (nobody matches yet), then marks a post
      markPost: t.boolean({
        resolve: async (_root, _args, ctx) => {
          await ctx.abilities.users.filter("read");
          await db
            .update(schema.posts)
            .set({ title: marker })
            .where(eq(schema.posts.id, data.posts[0]!.id));
          await db
            .update(schema.posts)
            .set({ ownerId: newOwner.id })
            .where(eq(schema.posts.id, data.posts[0]!.id));
          return true;
        },
      }),
      // the next root field reads with a fresh snapshot
      readableUsers: t.drizzleField({
        type: ["users"],
        resolve: async (query, _root, _args, ctx) =>
          db.query.users.findMany(
            query((await ctx.abilities.users.filter("read")).query.many),
          ),
      }),
    }));

    const yoga = r.createYoga({ maskedErrors: false });
    const executor = buildHTTPExecutor({
      fetch: yoga.fetch,
      endpoint: "http://yoga/graphql",
    });
    const result: any = await executor({
      document: parse(/* GraphQL */ `
        mutation {
          markPost
          readableUsers { id }
        }
      `),
    });

    expect(result.errors).toBeUndefined();
    expect(result.data.readableUsers).toEqual([{ id: newOwner.id }]);
  });
});
