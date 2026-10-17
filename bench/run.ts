import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { run } from "mitata";

// Usage: bun bench/run.ts [suite...] [--filter <regex>] [--json <file>]
// Suites: startup, request, abilities, helpers, client (all when none given)

const allSuites = ["startup", "request", "abilities", "helpers", "client"];

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    filter: { type: "string" },
    json: { type: "string" },
  },
});

const suites = positionals.length > 0 ? positionals : allSuites;
for (const suite of suites) {
  if (!allSuites.includes(suite)) {
    throw new Error(`unknown suite "${suite}", pick from ${allSuites}`);
  }
  // suites register their benches when imported
  await import(`./suites/${suite}.bench.ts`);
}

const result = await run({
  throw: true,
  filter: values.filter ? new RegExp(values.filter) : undefined,
});

if (values.json) {
  const names = result.benchmarks.flatMap((t) => t.runs.map((r) => r.name));
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) {
    // compare.ts matches results by name
    throw new Error(`bench name "${duplicate}" is not unique`);
  }

  // a compact form of the results, for bench/compare.ts
  const benchmarks = result.benchmarks.flatMap((trial) =>
    trial.runs.flatMap((r) =>
      r.stats
        ? [
            {
              name: r.name,
              avg: r.stats.avg,
              p50: r.stats.p50,
              p99: r.stats.p99,
              min: r.stats.min,
              max: r.stats.max,
              samples: r.stats.samples.length,
            },
          ]
        : [],
    ),
  );
  await writeFile(
    values.json,
    `${JSON.stringify({ context: result.context, benchmarks }, null, 2)}\n`,
  );
  console.log(`\nwrote ${benchmarks.length} results to ${values.json}`);
}
