import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, do_not_optimize, group } from "mitata";
import { generateFromSchema } from "../../lib/client/generate";
import { makeBenchDB } from "../fixtures/db";
import { makeBenchInstance } from "../fixtures/instance";
import { buildWideRumble, makeWideSchema } from "../fixtures/wideSchema";

// Client generation runs in dev servers on every schema change, so it should
// stay fast for large schemas.

const { db, data } = await makeBenchDB();
const small = makeBenchInstance(db, data.users[0].id).schema;
const large = buildWideRumble(makeWideSchema(50, 12)).buildSchema();
const out = await mkdtemp(join(tmpdir(), "rumble-bench-client-"));
process.once("beforeExit", () => rm(out, { recursive: true, force: true }));

group("client generation", () => {
  bench("generateFromSchema (3 tables)", async () => {
    do_not_optimize(
      await generateFromSchema({ schema: small, outputPath: join(out, "s") }),
    );
  });
  bench("generateFromSchema (50 tables)", async () => {
    do_not_optimize(
      await generateFromSchema({ schema: large, outputPath: join(out, "l") }),
    );
  });
});
