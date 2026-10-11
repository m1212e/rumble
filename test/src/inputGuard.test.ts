import { beforeEach, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

// Masking hides values after the query ran. A where / orderBy argument is
// applied on the real values, so it must only see what the caller may read.
describe("filter arguments respect column masks", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  let { rumble, build } = makeRumbleSeedInstance(db, data.users.at(0)?.id);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;
    const r = makeRumbleSeedInstance(db, data.users.at(0)?.id);
    rumble = r.rumble;
    build = r.build;

    // the email is readable on the own row only
    rumble.abilityBuilder.users.allow("read").when(({ userId }) => ({
      where: { id: userId },
    }));
    rumble.abilityBuilder.users.allow("read").when({
      columns: { id: true, firstName: true, lastName: true },
    });
  });

  const run = async (query: string) => {
    const { executor } = build();
    return (await executor({ document: parse(query) })) as any;
  };

  test("filtering by an unreadable column does not match foreign rows", async () => {
    const [self, other] = data.users;
    const r = await run(/* GraphQL */ `
      query {
        users(where: { email: { eq: "${other!.email}" } }) {
          id
        }
      }
    `);
    expect(r.errors).toBeUndefined();
    expect(r.data.users).toEqual([]);

    const own = await run(/* GraphQL */ `
      query {
        users(where: { email: { eq: "${self!.email}" } }) {
          id
          email
        }
      }
    `);
    expect(own.data.users).toEqual([{ id: self!.id, email: self!.email }]);
  });

  test("negated, combined and nested conditions reveal nothing either", async () => {
    const other = data.users[1]!;
    // the answer must not depend on the value of a column the caller cannot read
    const idsFor = async (email: string) => {
      const ids: string[][] = [];
      for (const where of [
        `{ NOT: { email: { eq: "${email}" } } }`,
        `{ OR: [{ email: { eq: "${email}" } }, { id: { eq: "nope" } }] }`,
        `{ AND: [{ email: { ne: "${email}" } }] }`,
        `{ email: { in: ["${email}"] } }`,
      ]) {
        const r = await run(/* GraphQL */ `
          query {
            users(where: ${where}) {
              id
            }
          }
        `);
        expect(r.errors).toBeUndefined();
        ids.push(r.data.users.map((u: any) => u.id).sort());
      }
      return ids;
    };
    expect(await idsFor(other.email)).toEqual(
      await idsFor("nobody@example.org"),
    );
  });

  test("readable columns filter as before", async () => {
    const other = data.users[1]!;
    const r = await run(/* GraphQL */ `
      query {
        users(where: { firstName: { eq: "${other.firstName}" } }) {
          id
        }
      }
    `);
    expect(r.errors).toBeUndefined();
    expect(r.data.users.map((u: any) => u.id)).toContain(other.id);
  });

  test("the count only counts what the filter may see", async () => {
    const other = data.users[1]!;
    const r = await run(/* GraphQL */ `
      query {
        usersCount(where: { email: { eq: "${other.email}" } })
      }
    `);
    expect(r.errors).toBeUndefined();
    expect(r.data.usersCount).toBe(0);
  });

  test("a relation filter cannot reach masked columns of the related rows", async () => {
    const other = data.users[1]!;
    rumble.abilityBuilder.posts.allow("read");
    const r = await run(/* GraphQL */ `
      query {
        posts(where: { author: { email: { eq: "${other.email}" } } }) {
          id
        }
      }
    `);
    expect(r.errors).toBeUndefined();
    expect(r.data.posts).toEqual([]);
  });

  test("sorting by an unreadable column does not order foreign rows", async () => {
    const asc = await run(/* GraphQL */ `
      query {
        users(orderBy: { email: asc }) {
          id
        }
      }
    `);
    const desc = await run(/* GraphQL */ `
      query {
        users(orderBy: { email: desc }) {
          id
        }
      }
    `);
    expect(asc.errors).toBeUndefined();
    expect(desc.errors).toBeUndefined();
    const self = data.users[0]!.id;
    // only the own row has a value to sort by, the rest tie
    const position = (r: any) =>
      r.data.users.findIndex((u: any) => u.id === self);
    expect([position(asc), position(desc)].sort((a, b) => a - b)).toEqual([
      0,
      asc.data.users.length - 1,
    ]);
  });

  test("without masks nothing changes", async () => {
    const other = data.users[1]!;
    const fresh = makeRumbleSeedInstance(db, data.users[0]!.id);
    fresh.rumble.abilityBuilder.users.allow("read");
    const { executor } = fresh.build();
    const r: any = await executor({
      document: parse(/* GraphQL */ `
        query {
          users(where: { email: { eq: "${other.email}" } }) {
            id
          }
        }
      `),
    });
    expect(r.errors).toBeUndefined();
    expect(r.data.users.map((u: any) => u.id)).toEqual([other.id]);
  });

  describe("relations follow the columns they join on", () => {
    // everybody reads all posts, but who wrote them only the author
    beforeEach(() => {
      rumble.abilityBuilder.posts.allow("read").when(({ userId }) => ({
        where: { ownerId: userId },
      }));
      rumble.abilityBuilder.posts.allow("read").when({
        columns: { id: true, title: true },
      });
    });

    test("a relation only lists related rows exposing the joined column", async () => {
      const self = data.users[0]!;
      const r = await run(/* GraphQL */ `
        query {
          users {
            id
            posts {
              id
            }
          }
        }
      `);
      expect(r.errors).toBeUndefined();
      const own = data.posts.filter((p: any) => p.ownerId === self.id);
      expect(own.length).toBeGreaterThan(0);
      for (const user of r.data.users) {
        const expected = user.id === self.id ? own.map((p: any) => p.id) : [];
        expect(user.posts.map((p: any) => p.id).sort()).toEqual(
          expected.sort(),
        );
      }
    });

    test("a relation resolves to nothing if the row's joined column is masked", async () => {
      const self = data.users[0]!;
      const r = await run(/* GraphQL */ `
        query {
          posts {
            id
            author {
              id
            }
          }
        }
      `);
      expect(r.errors).toBeUndefined();
      expect(r.data.posts.length).toBeGreaterThan(0);
      for (const post of r.data.posts) {
        const owner = data.posts.find((p: any) => p.id === post.id)!.ownerId;
        // only the own posts may tell who wrote them
        expect(post.author).toEqual(owner === self.id ? { id: self.id } : null);
      }
    });
  });
});
