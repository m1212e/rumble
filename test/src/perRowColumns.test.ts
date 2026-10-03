import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("per row column abilities", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  let { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;

    const r = makeRumbleSeedInstance(db, data.users.at(0)?.id);
    rumble = r.rumble;
    build = r.build;
  });

  // full own row, everyone else without email
  const registerSelfAndOthers = () => {
    rumble.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { id: userId },
    }));
    rumble.abilityBuilder.users.allow("read").when({
      columns: { id: true, firstName: true, lastName: true },
    });
  };

  test("non null masked column errors on foreign rows only", async () => {
    registerSelfAndOthers();
    const { executor } = build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            email
          }
        }
      `),
    });

    expect(r.data).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
    for (const error of r.errors) {
      expect(error.path.at(-1)).toEqual("email");
    }
  });

  test("nullable masked column resolves to null on foreign rows", async () => {
    rumble.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { id: userId },
    }));
    rumble.abilityBuilder.users.allow("read").when({
      columns: { id: true, firstName: true, email: true },
    });

    const { executor } = build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            lastName
          }
        }
      `),
    });

    expect(r.errors).toBeUndefined();
    const self = data.users[0];
    for (const u of r.data.users) {
      if (u.id === self.id) {
        expect(u.lastName).toEqual(self.lastName);
      } else {
        expect(u.lastName).toBeNull();
      }
    }
  });

  test("single query on own row returns the restricted column", async () => {
    registerSelfAndOthers();
    const { executor } = build();
    const self = data.users[0];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "${self.id}") {
            id
            email
          }
        }
      `),
    });

    expect(r).toEqual({ data: { user: { id: self.id, email: self.email } } });
  });

  test("single query on foreign row masks the restricted column", async () => {
    registerSelfAndOthers();
    const { executor } = build();
    const other = data.users[1];
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          user(id: "${other.id}") {
            id
            email
          }
        }
      `),
    });

    expect(r.errors.length).toEqual(1);
    expect(r.errors[0].path).toEqual(["user", "email"]);
  });

  test("relations mask per row as well", async () => {
    rumble.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { id: userId },
    }));
    rumble.abilityBuilder.users.allow("read").when({
      columns: { id: true, firstName: true, email: true },
    });
    rumble.abilityBuilder.posts.allow("read");

    const { executor } = build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          posts {
            id
            author {
              id
              lastName
            }
          }
        }
      `),
    });

    expect(r.errors).toBeUndefined();
    const self = data.users[0];
    let sawSelf = false;
    let sawOther = false;
    for (const p of r.data.posts) {
      if (!p.author) continue;
      if (p.author.id === self.id) {
        sawSelf = true;
        expect(p.author.lastName).toEqual(self.lastName);
      } else {
        sawOther = true;
        expect(p.author.lastName).toBeNull();
      }
    }
    expect(sawOther).toBeTrue();
    if (!sawSelf) {
      expect(data.posts.some((p: any) => p.ownerId === self.id)).toBeFalse();
    }
  });

  test("explicit columns on both abilities with a real where on the broader one", async () => {
    const self = data.users[0];
    rumble.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { id: userId },
      columns: { id: true, firstName: true, lastName: true, email: true },
    }));
    rumble.abilityBuilder.users.allow("read").when({
      where: { posts: true },
      columns: { id: true, firstName: true },
    });

    const { executor } = build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            firstName
            lastName
          }
        }
      `),
    });

    expect(r.errors).toBeUndefined();
    const owners = new Set(data.posts.map((p: any) => p.ownerId));
    const expectedIds = new Set([self.id, ...owners]);
    expect(new Set(r.data.users.map((u: any) => u.id))).toEqual(expectedIds);
    for (const u of r.data.users) {
      const original = data.users.find((d: any) => d.id === u.id)!;
      expect(u.firstName).toEqual(original.firstName);
      expect(u.lastName).toEqual(u.id === self.id ? original.lastName : null);
    }
  });

  test("relational where filters are evaluated on nested relation rows", async () => {
    const commentedPost = data.posts.find((p: any) =>
      data.comments.some((c: any) => c.postId === p.id),
    )!;
    const self = data.users.find((u: any) => u.id === commentedPost.ownerId)!;
    ({ rumble, build } = makeRumbleSeedInstance(db, self.id));

    rumble.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { comments: { post: { ownerId: userId } } },
    }));
    rumble.abilityBuilder.users.allow("read").when({
      columns: { id: true, firstName: true, email: true },
    });
    rumble.abilityBuilder.comments.allow("read");

    const commenters = new Set(
      data.comments
        .filter((c: any) =>
          data.posts.some(
            (p: any) => p.id === c.postId && p.ownerId === self.id,
          ),
        )
        .map((c: any) => c.ownerId),
    );

    const { executor } = build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          comments {
            id
            author {
              id
              lastName
            }
          }
        }
      `),
    });

    expect(r.errors).toBeUndefined();
    let sawVisible = false;
    let sawMasked = false;
    for (const c of r.data.comments) {
      const original = data.users.find((d: any) => d.id === c.author.id)!;
      if (commenters.has(c.author.id)) {
        sawVisible = true;
        expect(c.author.lastName).toEqual(original.lastName);
      } else {
        sawMasked = true;
        expect(c.author.lastName).toBeNull();
      }
    }
    expect(sawMasked).toBeTrue();
    expect(sawVisible).toBeTrue();
  });

  test("column restrictions of a single ability apply to relations", async () => {
    rumble.abilityBuilder.users.allow("read").when({
      columns: { id: true, firstName: true, email: true },
    });
    rumble.abilityBuilder.posts.allow("read");

    const { executor } = build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          posts {
            author {
              id
              lastName
              fullName
            }
          }
        }
      `),
    });

    expect(r.errors).toBeUndefined();
    for (const p of r.data.posts) {
      expect(p.author.lastName).toBeNull();
      expect(p.author.fullName).toEqual(
        `${
          data.users.find((d: any) => d.id === p.author.id)!.firstName
        } undefined`,
      );
    }
  });

  test("custom resolvers using the read filter are masked per row", async () => {
    registerSelfAndOthers();
    rumble.abilityBuilder.users.allow("update");
    const { executor } = build();
    const [self, other] = data.users;

    const own: any = await executor({
      document: parse(/* GraphQL */ `
        mutation {
          updateUsername(userId: "${self.id}", firstName: "a") {
            id
            email
          }
        }
      `),
    });
    expect(own.errors).toBeUndefined();
    expect(own.data.updateUsername.email).toEqual(self.email);

    const foreign: any = await executor({
      document: parse(/* GraphQL */ `
        mutation {
          updateUsername(userId: "${other.id}", firstName: "b") {
            id
            email
          }
        }
      `),
    });
    expect(foreign.errors.length).toEqual(1);
    expect(foreign.errors[0].path).toEqual(["updateUsername", "email"]);
  });

  test("rows reused by another request are masked for that request", async () => {
    const [first, second] = data.users;
    const cache = new Map<string, any>();

    const makeInstance = (userId: string) => {
      const instance = makeRumbleSeedInstance(db, userId);
      instance.rumble.abilityBuilder.users
        .allow("read")
        .when(({ userId }) => ({ where: { id: userId } }));
      instance.rumble.abilityBuilder.users.allow("read").when({
        columns: { id: true, firstName: true, lastName: true },
      });
      instance.rumble.schemaBuilder.queryField("cachedUser", (t) =>
        t.drizzleField({
          type: "users",
          args: { id: t.arg.string({ required: true }) },
          resolve: async (query, _root, args, ctx) => {
            // a cache hit skips query(), so pothos reloads the row on its own
            if (!cache.has(args.id)) {
              const filter = (await ctx.abilities.users.filter("read")).merge({
                where: { id: args.id },
              }).query.single;
              cache.set(args.id, await db.query.users.findFirst(query(filter)));
            }
            return cache.get(args.id);
          },
        }),
      );
      return instance.build().executor;
    };

    const document = parse(/* GraphQL */ `
      query {
        cachedUser(id: "${first.id}") {
          id
          email
        }
      }
    `);

    const own: any = await makeInstance(first.id)({ document });
    expect(own.errors).toBeUndefined();
    expect(own.data.cachedUser.email).toEqual(first.email);

    const foreign: any = await makeInstance(second.id)({ document });
    expect(foreign.errors.length).toEqual(1);
    expect(foreign.errors[0].path).toEqual(["cachedUser", "email"]);
  });

  test("runtime filters see the rows before they are masked", async () => {
    registerSelfAndOthers();
    rumble.abilityBuilder.posts.allow("read");
    const seenEmails: unknown[] = [];
    rumble.abilityBuilder.users.filter("read").by(({ entities }) => {
      seenEmails.push(...entities.map((e) => e.email));
      return entities;
    });

    const { executor } = build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users {
            id
            firstName
          }
          posts(limit: 5) {
            author {
              id
              firstName
            }
          }
        }
      `),
    });

    expect(r.errors).toBeUndefined();
    expect(seenEmails.length).toBeGreaterThan(5);
    for (const email of seenEmails) expect(typeof email).toEqual("string");
  });

  test("masking keeps the row shape and runs synchronously once resolved", async () => {
    registerSelfAndOthers();
    const self = data.users[0];
    const abilities = rumble.abilityBuilder._.build()({ userId: self.id });
    const rows: any[] = await db.query.users.findMany(
      (await abilities.users.filter("read")).query.many as any,
    );
    const keysBefore = rows.map((row) => Object.keys(row));
    expect(keysBefore[0]).toContain("__rumble_columns");

    const result = rumble.abilityBuilder._.maskColumns({
      table: "users",
      action: "read",
      abilities,
      entities: rows,
    });
    expect(result).toBeUndefined();

    rows.forEach((row, index) => {
      expect(Object.keys(row)).toEqual(keysBefore[index]!);
      expect(row.__rumble_columns).toBeUndefined();
      const original = data.users.find((u: any) => u.id === row.id)!;
      expect(row.lastName).toEqual(original.lastName);
      expect(row.email).toEqual(
        row.id === self.id ? original.email : undefined,
      );
    });
  });

  describe("rows pothos reloads on its own", () => {
    // returns the row without query(), so pothos reloads it
    const registerDirectUpdate = () => {
      rumble.abilityBuilder.users.allow("update");
      rumble.schemaBuilder.mutationField("renameDirect", (t) =>
        t.drizzleField({
          type: "users",
          args: {
            id: t.arg.string({ required: true }),
            firstName: t.arg.string({ required: true }),
          },
          resolve: async (_query, _root, args) => {
            const [row] = await db
              .update(schema.users)
              .set({ firstName: args.firstName })
              .where(eq(schema.users.id, args.id))
              .returning();
            return row!;
          },
        }),
      );
    };

    const rename = (executor: any, id: string, selection: string) =>
      executor({
        document: parse(/* GraphQL */ `
          mutation {
            renameDirect(id: "${id}", firstName: "renamed") {
              ${selection}
            }
          }
        `),
      });

    test("applies the column abilities of the reloaded row", async () => {
      registerSelfAndOthers();
      registerDirectUpdate();
      const { executor } = build();
      const [self, other] = data.users;

      const own: any = await rename(executor, self.id, "id firstName email");
      expect(own.errors).toBeUndefined();
      expect(own.data.renameDirect).toEqual({
        id: self.id,
        firstName: "renamed",
        email: self.email,
      });

      const foreign: any = await rename(executor, other.id, "id email");
      expect(foreign.errors.length).toEqual(1);
      expect(foreign.errors[0].path).toEqual(["renameDirect", "email"]);
    });

    test("does not find rows the requester may not read", async () => {
      rumble.abilityBuilder.users.allow("read").when(({ userId }) => ({
        where: { id: userId },
      }));
      registerDirectUpdate();
      const { executor } = build();
      const [self, other] = data.users;

      const own: any = await rename(executor, self.id, "id firstName");
      expect(own.errors).toBeUndefined();
      expect(own.data.renameDirect.firstName).toEqual("renamed");

      const foreign: any = await rename(executor, other.id, "id firstName");
      expect(foreign.data).toBeNull();
      expect(foreign.errors[0].path).toEqual(["renameDirect", "id"]);
    });
  });
});
