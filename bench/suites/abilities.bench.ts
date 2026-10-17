import { bench, do_not_optimize, group, summary } from "mitata";
import { guardFilterInput } from "../../lib";
import { makeBenchDB } from "../fixtures/db";
import { type AbilityScenario, makeBenchInstance } from "../fixtures/instance";
import { assertOk, queries } from "../fixtures/queries";
import { buildWideRumble, makeWideSchema } from "../fixtures/wideSchema";

// The cost of the authorization layer: building the per request abilities,
// evaluating conditions, masking columns and guarding client filter input.

const { db, data } = await makeBenchDB();
const viewer = data.users[0].id;

const scenarios: AbilityScenario[] = [
  "open",
  "static",
  "dynamic",
  "async",
  "many",
  "columnMask",
  "runtimeFilter",
];
const instances = Object.fromEntries(
  scenarios.map((s) => [s, makeBenchInstance(db, viewer, { abilities: s })]),
) as Record<AbilityScenario, ReturnType<typeof makeBenchInstance>>;

const list = /* GraphQL */ `{ users(limit: 100) { id firstName lastName } }`;
for (const s of scenarios) {
  assertOk(await instances[s].execute(list), `${s} list`);
}
assertOk(await instances.columnMask.execute(queries.guardedOrderBy), "guarded");

summary(() => {
  group("abilities: 100 users end to end", () => {
    for (const s of scenarios) {
      const b = bench(`e2e ${s}`, async () => {
        do_not_optimize(await instances[s].execute(list));
      });
      if (s === "open") b.baseline();
    }
  });
});

summary(() => {
  group("abilities: filter() on a fresh request context", () => {
    for (const s of scenarios) {
      const b = bench(`filter() ${s}`, async () => {
        const ctx = instances[s].makeContext();
        do_not_optimize(await ctx.abilities.users.filter("read"));
      });
      if (s === "open") b.baseline();
    }
  });
});

const ctx = instances.dynamic.makeContext();
const resolved = await ctx.abilities.users.filter("read");

group("abilities: filter helpers", () => {
  bench("filter() again within the same request", async () => {
    do_not_optimize(await ctx.abilities.users.filter("read"));
  });
  bench("merge() a where into a filter", () => {
    do_not_optimize(
      resolved.merge({ where: { firstName: { like: "First1%" } } }).query.many,
    );
  });

  for (const s of ["open", "columnMask"] as const) {
    bench(`guardFilterInput (${s})`, async () => {
      const c = instances[s].makeContext();
      do_not_optimize(
        await guardFilterInput(c.abilities, "users", "read", {
          where: { email: { like: "user1%" }, firstName: { isNotNull: true } },
          orderBy: { email: "asc" },
        }),
      );
    });
  }
});

summary(() => {
  group("abilities: orderBy on a masked column", () => {
    bench("orderBy email, open", async () => {
      do_not_optimize(await instances.open.execute(queries.guardedOrderBy));
    }).baseline();
    bench("orderBy email, columnMask (rewritten)", async () => {
      do_not_optimize(
        await instances.columnMask.execute(queries.guardedOrderBy),
      );
    });
  });
});

summary(() => {
  group("abilities: request context scaling", () => {
    bench("build request context ($tables tables)", function* (state: any) {
      const r = buildWideRumble(makeWideSchema(state.get("tables"), 12));
      r.buildSchema();
      const build = r.abilityBuilder._.build();
      yield () => do_not_optimize(build({ userId: viewer }));
    }).args("tables", [10, 50, 100]);
  });
});
