import { beforeEach, describe, expect, test } from "bun:test";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("where argument filters", async () => {
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

  describe("float / numeric where", () => {
    test("gt returns only comments with someNumber above the threshold", async () => {
      rumble.abilityBuilder.comments.allow(["read"]);
      const { executor } = build();

      const allNumbers = data.comments.map((c) => c.someNumber ?? 0);
      const threshold = Math.floor(
        (Math.max(...allNumbers) + Math.min(...allNumbers)) / 2,
      );

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            comments(where: { someNumber: { gt: ${threshold} } }) {
              id
              someNumber
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      const comments: Array<{ id: string; someNumber: number }> = (r as any)
        .data.comments;
      expect(comments.length).toBeGreaterThan(0);
      for (const c of comments) {
        expect(c.someNumber).toBeGreaterThan(threshold);
      }
    });

    test("lt returns only comments with someNumber below the threshold", async () => {
      rumble.abilityBuilder.comments.allow(["read"]);
      const { executor } = build();

      const allNumbers = data.comments.map((c) => c.someNumber ?? 0);
      const threshold = Math.floor(
        (Math.max(...allNumbers) + Math.min(...allNumbers)) / 2,
      );

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            comments(where: { someNumber: { lt: ${threshold} } }) {
              id
              someNumber
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      const comments: Array<{ id: string; someNumber: number }> = (r as any)
        .data.comments;
      expect(comments.length).toBeGreaterThan(0);
      for (const c of comments) {
        expect(c.someNumber).toBeLessThan(threshold);
      }
    });

    test("eq returns only comments matching a specific value", async () => {
      rumble.abilityBuilder.comments.allow(["read"]);
      const { executor } = build();

      const targetNumber = data.comments[0].someNumber ?? 0;

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            comments(where: { someNumber: { eq: ${targetNumber} } }) {
              id
              someNumber
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      const comments: Array<{ id: string; someNumber: number }> = (r as any)
        .data.comments;
      expect(comments.length).toBeGreaterThan(0);
      for (const c of comments) {
        expect(c.someNumber).toBe(targetNumber);
      }
    });
  });

  describe("string where", () => {
    test("eq returns only users with that exact firstName", async () => {
      rumble.abilityBuilder.users.allow(["read"]);
      const { executor } = build();

      const targetFirstName = data.users[0].firstName!;

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            users(where: { firstName: { eq: "${targetFirstName}" } }) {
              id
              firstName
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      const users: Array<{ id: string; firstName: string }> = (r as any).data
        .users;
      expect(users.length).toBeGreaterThan(0);
      for (const u of users) {
        expect(u.firstName).toBe(targetFirstName);
      }
    });

    test("isNull returns only users where firstName is null", async () => {
      rumble.abilityBuilder.users.allow(["read"]);
      const { executor } = build();

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            users(where: { firstName: { isNull: true } }) {
              id
              firstName
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      // All seeded users have non-null firstNames, so result should be empty
      expect((r as any).data.users).toHaveLength(0);
    });

    test("isNotNull returns all users with a firstName set", async () => {
      rumble.abilityBuilder.users.allow(["read"]);
      const { executor } = build();

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            users(where: { firstName: { isNotNull: true } }, limit: 5) {
              id
              firstName
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      const users: Array<{ id: string; firstName: string | null }> = (r as any)
        .data.users;
      expect(users.length).toBeGreaterThan(0);
      for (const u of users) {
        expect(u.firstName).not.toBeNull();
      }
    });
  });

  describe("nested relation where", () => {
    test("filtering posts by author's firstName returns only matching posts", async () => {
      rumble.abilityBuilder.users.allow(["read"]);
      rumble.abilityBuilder.posts.allow(["read"]);
      const { executor } = build();

      // Pick the firstName shared by the first post's author
      const firstPost = data.posts[0];
      const authorFirstName = data.users.find(
        (u) => u.id === firstPost.ownerId,
      )!.firstName!;

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            posts(where: { author: { firstName: { eq: "${authorFirstName}" } } }) {
              id
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      const returnedPosts: Array<{ id: string }> = (r as any).data.posts;
      expect(returnedPosts.length).toBeGreaterThan(0);

      // Every returned post should have an author with that firstName
      for (const post of returnedPosts) {
        const full = data.posts.find((p) => p.id === post.id)!;
        const owner = data.users.find((u) => u.id === full.ownerId);
        expect(owner?.firstName).toBe(authorFirstName);
      }
    });
  });

  describe("where combined with limit", () => {
    test("where + limit compose correctly", async () => {
      rumble.abilityBuilder.users.allow(["read"]);
      const { executor } = build();

      const r = await executor({
        document: parse(/* GraphQL */ `
          query {
            users(where: { firstName: { isNotNull: true } }, limit: 3) {
              id
              firstName
            }
          }
        `),
      });

      expect((r as any).errors).toBeUndefined();
      expect((r as any).data.users.length).toBeLessThanOrEqual(3);
    });
  });
});
