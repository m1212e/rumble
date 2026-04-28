import { defineConfig } from "tsdown";
import packagejson from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "lib/index.ts",
    client: "lib/client/index.ts",
    "client/generate": "lib/client/generate/index.ts",
  },
  format: ["cjs", "esm"],
  outDir: "out",
  sourcemap: true,
  dts: {
    sourcemap: true,
  },
  exports: true,
  deps: {
    neverBundle: [
      "@whatwg-node/fetch",
      ...Object.keys(packagejson.devDependencies),
    ],
  },
});
