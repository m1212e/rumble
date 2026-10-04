import { describe, expect, test } from "bun:test";
import { makeSeededDBInstanceForTest } from "./db/db";
import * as schema from "./db/schema";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

describe("sql where of relational ability filters", () => {
  test("matches the query api for filters nested three relations deep", async () => {
    const { db, data } = await makeSeededDBInstanceForTest();
    const { rumble } = makeRumbleSeedInstance(db, data.users[0].id);
    const commenter = data.comments[0].ownerId;

    // users with a post that has a comment by the commenter
    rumble.abilityBuilder.users.allow("read").when({
      where: { posts: { comments: { author: { id: commenter } } } },
    });
    const abilities = rumble.abilityBuilder._.build()({
      userId: data.users[0].id,
    });
    const filter = await abilities.users.filter("read");

    const viaQuery = await db.query.users.findMany({
      where: filter.query.many.where as any,
      columns: { id: true },
    });
    const viaSql = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(filter.sql.where);

    expect(viaQuery.length).toBeGreaterThan(0);
    expect(new Set(viaSql.map((u) => u.id))).toEqual(
      new Set(viaQuery.map((u) => u.id)),
    );
  });
});
