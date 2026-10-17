import { readFile } from "node:fs/promises";

// Usage: bun bench/compare.ts <base.json> <head.json> [--threshold <percent>]
// Compares the p50 of two `bun bench/run.ts --json` results. Exits with 1 when
// a bench got slower than the threshold (default 10%).

type Result = { benchmarks: { name: string; p50: number }[] };

const [basePath, headPath, ...rest] = Bun.argv.slice(2);
if (!basePath || !headPath) {
  console.error("usage: bun bench/compare.ts <base.json> <head.json>");
  process.exit(2);
}
const thresholdIndex = rest.indexOf("--threshold");
const threshold =
  thresholdIndex === -1 ? 10 : Number(rest[thresholdIndex + 1] ?? 10);

const load = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as Result;
const base = new Map((await load(basePath)).benchmarks.map((b) => [b.name, b]));
const head = (await load(headPath)).benchmarks;

const format = (ns: number) =>
  ns >= 1e6
    ? `${(ns / 1e6).toFixed(2)} ms`
    : ns >= 1e3
      ? `${(ns / 1e3).toFixed(2)} µs`
      : `${ns.toFixed(0)} ns`;

const isRegression = (change: number) => change > threshold;
const formatChange = (change: number) =>
  `${change > 0 ? "+" : ""}${change.toFixed(1)}%${isRegression(change) ? " ⚠" : ""}`;

const changes = head.map((h) => {
  const b = base.get(h.name);
  return { h, b, change: b ? ((h.p50 - b.p50) / b.p50) * 100 : undefined };
});
const regressions = changes.filter(
  (c) => c.change !== undefined && isRegression(c.change),
).length;
const rows = changes.map(({ h, b, change }) =>
  b && change !== undefined
    ? [h.name, format(b.p50), format(h.p50), formatChange(change)]
    : [h.name, "-", format(h.p50), "new"],
);

const header = ["bench", "base p50", "head p50", "change"];
const widths = header.map((_, i) =>
  Math.max(header[i].length, ...rows.map((r) => r[i].length)),
);
for (const row of [header, ...rows]) {
  console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
}

if (regressions > 0) {
  console.log(`\n${regressions} bench(es) slower than ${threshold}%`);
  process.exit(1);
}
