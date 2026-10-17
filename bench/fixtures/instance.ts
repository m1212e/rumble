import { trace } from "@opentelemetry/api";
import { rumble } from "../../lib";
import type { RumbleLogger } from "../../lib/types/rumbleInput";
import { type BenchDB, schema } from "./db";

export type AbilityScenario =
  /** everything readable, no conditions */
  | "open"
  /** one static condition object */
  | "static"
  /** one condition function, evaluated per request */
  | "dynamic"
  /** one async condition function, evaluated per request */
  | "async"
  /** ten condition functions, ORed together */
  | "many"
  /** full own row, a column subset on all others (per row masking) */
  | "columnMask"
  /** application level filter running over the query result */
  | "runtimeFilter";

export type InstanceOptions = {
  abilities?: AbilityScenario;
  /** enables otel (with the no-op global tracer) and a no-op logger */
  telemetry?: boolean;
  /** `false` installs graphql-armor and disables introspection, like production */
  enableApiDocs?: boolean;
  defaultLimit?: number | null;
};

const noopLogger: RumbleLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child: () => noopLogger,
};

type Context = { userId: string };

/**
 * Builds a rumble instance over the bench database. The viewer is taken from
 * the `x-user-id` header so a bench can vary it per request.
 */
export function makeBenchInstance(
  db: BenchDB,
  viewerId: string,
  {
    abilities = "open",
    telemetry = false,
    enableApiDocs = true,
    defaultLimit = null,
  }: InstanceOptions = {},
) {
  const userContext = (req: { request?: Request }): Context => ({
    userId: req.request?.headers.get("x-user-id") ?? viewerId,
  });

  const r = rumble({
    db,
    schema,
    context: userContext,
    defaultLimit,
    ...(telemetry
      ? {
          otel: { enabled: true, tracer: trace.getTracer("rumble-bench") },
          logger: { enabled: true, logger: noopLogger },
        }
      : {}),
  });

  registerAbilities(r.abilityBuilder, abilities);

  r.object({ refName: "User", table: "users" });
  r.object({ refName: "Post", table: "posts" });
  r.object({ refName: "Comment", table: "comments" });
  r.query({ table: "users" });
  r.query({ table: "posts" });
  r.query({ table: "comments" });
  r.countQuery({ table: "users" });
  r.countQuery({ table: "comments" });

  const yoga = r.createYoga({ enableApiDocs, maskedErrors: false });
  const builtAbilities = r.abilityBuilder._.build();

  /** Runs a GraphQL request through yoga's fetch handler, without a socket. */
  const execute = async (
    query: string,
    variables?: Record<string, unknown>,
    userId = viewerId,
  ) => {
    const res = await yoga.fetch("http://bench/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ query, variables }),
    });
    return (await res.json()) as { data?: any; errors?: any[] };
  };

  /** The context rumble hands to the resolvers, built like the yoga one. */
  const makeContext = (userId = viewerId) => {
    const user = userContext({
      request: new Request("http://bench", {
        headers: { "x-user-id": userId },
      }),
    });
    return { ...user, abilities: builtAbilities(user) };
  };

  return { rumble: r, yoga, schema: r.buildSchema(), execute, makeContext };
}

type AbilityBuilder = ReturnType<
  typeof rumble<Context, BenchDB, any, any, typeof schema>
>["abilityBuilder"];

// all scenarios except the masked one return (nearly) the same rows, so their
// timings differ by the ability evaluation, not by the amount of data
const scenarios: Record<AbilityScenario, (ab: AbilityBuilder) => void> = {
  open: (ab) => ab.users.allow("read"),
  static: (ab) => {
    ab.users.allow("read").when({ where: { email: { isNotNull: true } } });
  },
  dynamic: (ab) => {
    ab.users.allow("read").when(({ userId }) => ({
      where: { id: { ne: `not-${userId}` } },
    }));
  },
  async: (ab) => {
    ab.users.allow("read").when(async ({ userId }) => ({
      where: { id: { ne: `not-${userId}` } },
    }));
  },
  many: (ab) => {
    for (let i = 0; i < 10; i++) {
      ab.users.allow("read").when(({ userId }) => ({
        where: { id: { ne: `not-${userId}-${i}` } },
      }));
    }
  },
  columnMask: (ab) => {
    ab.users.allow("read").when(({ userId }) => ({ where: { id: userId } }));
    ab.users.allow("read").when({
      columns: { id: true, firstName: true, lastName: true },
    });
  },
  runtimeFilter: (ab) => {
    ab.users.allow("read");
    ab.users.filter("read").by(({ entities }) => entities);
  },
};

function registerAbilities(ab: AbilityBuilder, scenario: AbilityScenario) {
  // posts and comments stay open in every scenario so the nested benches
  // measure the users table only
  ab.posts.allow("read");
  ab.comments.allow("read");
  scenarios[scenario](ab);
}
