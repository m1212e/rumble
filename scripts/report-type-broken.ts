#!/usr/bin/env bun

/**
 * Scans the repo for `TYPE-BROKEN:` markers and prints a report.
 *
 * Convention used in type tests (see test/src/types/*.test-d.ts):
 *
 *   // @ts-expect-error TYPE-BROKEN: <short reason>
 *   expectTypeOf<...>().toEqualTypeOf<...>();
 *
 * The `@ts-expect-error` silences the failing assertion so the
 * typecheck stays green, while this report makes the broken cases
 * impossible to forget. If a broken case ever gets fixed,
 * `@ts-expect-error` becomes a TS error on its own — tsc tells you
 * about that without help.
 */

import { relative } from "node:path";
import { Glob } from "bun";

const ROOT = new URL("..", import.meta.url).pathname;

const TARGETS = ["lib", "test", "example", "scripts"];
const SKIP_DIRS = new Set([
  "node_modules",
  "out",
  "coverage",
  "dist",
  ".git",
  "drizzle",
]);

type Hit = { file: string; line: number; reason: string };

const hits: Hit[] = [];

for (const target of TARGETS) {
  const glob = new Glob("**/*.{ts,tsx,mts,cts}");
  for await (const rel of glob.scan({
    cwd: `${ROOT}${target}`,
    onlyFiles: true,
    dot: false,
  })) {
    if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
    const abs = `${ROOT}${target}/${rel}`;
    const src = await Bun.file(abs).text();
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // A real marker is a line-comment beginning with `// @ts-expect-error
      // TYPE-BROKEN:`. JSDoc lines (which start with `*`) won't match — that
      // keeps prose examples in docstrings out of the report.
      const match = lines[i].match(
        /^\s*\/\/\s*@ts-expect-error\s+TYPE-BROKEN:\s*(.*?)\s*$/,
      );
      if (!match) continue;
      const reason = match[1].trim();
      hits.push({
        file: relative(ROOT, abs),
        line: i + 1,
        reason: reason || "(no reason given)",
      });
    }
  }
}

if (hits.length === 0) {
  console.log("No TYPE-BROKEN markers found. All type assertions are sound.");
  process.exit(0);
}

console.log(
  `${hits.length} TYPE-BROKEN marker${hits.length === 1 ? "" : "s"} found:\n`,
);
for (const h of hits) {
  console.log(`  ${h.file}:${h.line}`);
  console.log(`    ${h.reason}`);
}
console.log(
  "\nThese are known-broken type cases. Fix one and remove its `@ts-expect-error TYPE-BROKEN:` marker.",
);
// Non-zero exit so CI can fail-on-marker if desired.
process.exit(hits.length > 0 ? 1 : 0);
