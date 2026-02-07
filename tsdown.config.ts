import { defineConfig } from "tsdown";
import packagejson from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "lib/index.ts",
    client: "lib/client/index.ts",
    "client/generate": "lib/client/generate/index.ts",
  },
  dts: {
    sourcemap: true,
    parallel: false,
  },
  format: ["cjs", "esm"],
  outDir: "out",
  inlineOnly: false,
  external: [
    // enforce also devDependencies are not bundled
    ...Object.keys(packagejson.devDependencies),
  ],
  sourcemap: true,
  exports: true,
});
