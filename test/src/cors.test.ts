import { describe, expect, test } from "bun:test";
import { makeSeededDBInstanceForTest } from "./db/db";
import { makeRumbleSeedInstance } from "./rumble/baseInstance";

const ORIGIN = "https://evil.example";

async function preflight(
  args?: Parameters<
    ReturnType<typeof makeRumbleSeedInstance>["rumble"]["createYoga"]
  >[0],
) {
  const { db, data } = await makeSeededDBInstanceForTest();
  const { rumble } = makeRumbleSeedInstance(db, data.users.at(0)?.id, 9);
  rumble.abilityBuilder.users.allow(["read"]);
  const yoga = rumble.createYoga(args);
  return yoga.fetch("http://yoga/graphql", {
    method: "OPTIONS",
    headers: {
      origin: ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
}

describe("createYoga cors", () => {
  test("sends no CORS headers by default, so a cookie session is never usable cross-site", async () => {
    const response = await preflight();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("honours an explicit cors option", async () => {
    const response = await preflight({
      cors: { origin: [ORIGIN], credentials: true },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });
});
