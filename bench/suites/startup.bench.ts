import { bench, do_not_optimize, group, summary } from "mitata";
import { makeBenchDB } from "../fixtures/db";
import { makeBenchInstance } from "../fixtures/instance";
import { queries } from "../fixtures/queries";
import { buildWideRumble, makeWideSchema } from "../fixtures/wideSchema";

// What a server pays once at boot (and every test suite or serverless cold
// start pays again): registering the helpers, building the pothos schema and
// creating the yoga instance.

const { db, data } = await makeBenchDB();
const viewer = data.users[0].id;

group("startup", () => {
  bench("rumble instance + schema (3 tables)", () => {
    do_not_optimize(makeBenchInstance(db, viewer));
  });

  bench("cold start: instance + first request", async () => {
    const instance = makeBenchInstance(db, viewer);
    do_not_optimize(await instance.execute(queries.list10));
  });

  const built = makeBenchInstance(db, viewer);
  bench("createYoga on a built schema (production config)", () => {
    do_not_optimize(built.rumble.createYoga({ enableApiDocs: false }));
  });
});

summary(() => {
  group("schema build scaling (12 columns per table)", () => {
    bench("build schema ($tables tables)", function* (state: any) {
      const tables: number = state.get("tables");
      // creating the drizzle schema is not part of what rumble does at boot
      const wide = makeWideSchema(tables, 12);
      yield () => do_not_optimize(buildWideRumble(wide).buildSchema());
    }).args("tables", [10, 50, 100]);
  });
});
