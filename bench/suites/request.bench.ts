import { execute, parse } from "graphql";
import { bench, do_not_optimize, group, summary } from "mitata";
import { makeBenchDB } from "../fixtures/db";
import { makeBenchInstance } from "../fixtures/instance";
import { assertOk, queries } from "../fixtures/queries";

// End to end requests through yoga's fetch handler against SQLite in memory.
// The database is fast enough that the timings are dominated by rumble,
// pothos, graphql-js and yoga, which is what these benches are after.

const { db, data } = await makeBenchDB();
const viewer = data.users[0].id;
const instance = makeBenchInstance(db, viewer);

for (const [label, query] of Object.entries(queries)) {
  assertOk(await instance.execute(query, { id: data.users[3].id }), label);
}

summary(() => {
  group("layers: 100 users", () => {
    bench("drizzle findMany, 100 users (baseline)", async () => {
      do_not_optimize(
        await db.query.users.findMany({
          limit: 100,
          columns: { id: true, firstName: true, lastName: true, email: true },
        }),
      );
    }).baseline();

    const document = parse(queries.list100);
    bench("graphql execute, 100 users (no yoga)", async () => {
      do_not_optimize(
        await execute({
          schema: instance.schema,
          document,
          contextValue: instance.makeContext(),
        }),
      );
    });

    bench("yoga fetch, 100 users (full request)", async () => {
      do_not_optimize(await instance.execute(queries.list100));
    });
  });
});

summary(() => {
  group("layers: nested users > posts > comments", () => {
    bench("drizzle findMany with relations (baseline)", async () => {
      do_not_optimize(
        await db.query.users.findMany({
          limit: 20,
          columns: { id: true, firstName: true },
          with: {
            posts: {
              columns: { id: true, title: true },
              with: { comments: { columns: { id: true, text: true } } },
            },
          },
        }),
      );
    }).baseline();

    bench("yoga fetch, nested (full request)", async () => {
      do_not_optimize(await instance.execute(queries.nested));
    });
  });
});

summary(() => {
  group("result size", () => {
    bench("yoga fetch, 10 users", async () => {
      do_not_optimize(await instance.execute(queries.list10));
    }).baseline();
    bench("yoga fetch, 100 users (result size)", async () => {
      do_not_optimize(await instance.execute(queries.list100));
    });
    bench("yoga fetch, 500 users", async () => {
      do_not_optimize(await instance.execute(queries.list500));
    });
  });
});

group("query shapes", () => {
  bench("single by id", async () => {
    do_not_optimize(
      await instance.execute(queries.byId, { id: data.users[3].id }),
    );
  });
  bench("nested users > posts > comments (340 rows)", async () => {
    do_not_optimize(await instance.execute(queries.nested));
  });
  bench("nested comments > author, post (100 rows)", async () => {
    do_not_optimize(await instance.execute(queries.nestedBackwards));
  });
  bench("where argument", async () => {
    do_not_optimize(await instance.execute(queries.where));
  });
  bench("where on a relation", async () => {
    do_not_optimize(await instance.execute(queries.whereRelation));
  });
  bench("orderBy argument", async () => {
    do_not_optimize(await instance.execute(queries.orderBy));
  });
  bench("count queries", async () => {
    do_not_optimize(await instance.execute(queries.count));
  });
});

const production = makeBenchInstance(db, viewer, { enableApiDocs: false });
const telemetry = makeBenchInstance(db, viewer, { telemetry: true });
const both = makeBenchInstance(db, viewer, {
  enableApiDocs: false,
  telemetry: true,
});

summary(() => {
  group("server configuration: nested query", () => {
    bench("api docs on, telemetry off", async () => {
      do_not_optimize(await instance.execute(queries.nested));
    }).baseline();
    bench("armor + introspection disabled", async () => {
      do_not_optimize(await production.execute(queries.nested));
    });
    bench("telemetry (no-op tracer and logger)", async () => {
      do_not_optimize(await telemetry.execute(queries.nested));
    });
    bench("armor + telemetry", async () => {
      do_not_optimize(await both.execute(queries.nested));
    });
  });
});
