import { beforeEach, describe, expect, test } from "bun:test";
import { buildHTTPExecutor } from "@graphql-tools/executor-http";
import { parse } from "graphql";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

// depth-11 path: users(1) -> posts(2) -> comments(3) -> author(4) -> posts(5) -> comments(6) -> author(7) -> posts(8) -> comments(9) -> author(10) -> id(11)
const DEEP_QUERY = /* GraphQL */ `
  query {
    users {
      posts {
        comments {
          author {
            posts {
              comments {
                author {
                  posts {
                    comments {
                      author {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function buildYoga(
  rumble: ReturnType<typeof makeRumbleSeedInstance>["rumble"],
  args?: Parameters<
    ReturnType<typeof makeRumbleSeedInstance>["rumble"]["createYoga"]
  >[0],
) {
  const yogaInstance = rumble.createYoga(args);
  const executor = buildHTTPExecutor({
    fetch: yogaInstance.fetch,
    endpoint: "http://yoga/graphql",
  });
  return { yogaInstance, executor };
}

describe("createYoga armorConfig", async () => {
  let { db, data } = await makeSeededDBInstanceForTest();
  // @ts-expect-error
  let { rumble } = makeRumbleSeedInstance(db, data.users.at(0)?.id, 9);

  beforeEach(async () => {
    const s = await makeSeededDBInstanceForTest();
    db = s.db;
    data = s.data;
    // @ts-expect-error
    const r = makeRumbleSeedInstance(db, data.users.at(0)?.id, 9);
    rumble = r.rumble;
    rumble.abilityBuilder.users.allow(["read"]);
    rumble.abilityBuilder.posts.allow(["read"]);
    rumble.abilityBuilder.comments.allow(["read"]);
  });

  test("default armor config rejects deep queries in production mode", async () => {
    const { executor } = buildYoga(rumble, {
      enableApiDocs: false,
      armorConfig: { maxDepth: { n: 10 } },
    });

    const r = await executor({ document: parse(DEEP_QUERY) });

    expect((r as any).errors?.length).toBeGreaterThan(0);
  });

  test("custom armorConfig allows deeper queries", async () => {
    const { executor } = buildYoga(rumble, {
      enableApiDocs: false,
      armorConfig: { maxDepth: { n: 12 } },
    });

    const r = await executor({ document: parse(DEEP_QUERY) });

    expect((r as any).errors).toBeUndefined();
  });
});
