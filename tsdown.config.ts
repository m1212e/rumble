import { defineConfig } from "tsdown";
import packagejson from "./package.json" with { type: "json" };

export default defineConfig({
  entry: "lib/index.ts",
  dts: {
    sourcemap: true,
    parallel: false,
  },
  format: ["cjs", "esm"],
  outDir: "out",
  external: [
    // enforce also devDependencies are not bundled
    ...Object.keys(packagejson.devDependencies),
  ],
  sourcemap: true,
  exports: true,
});
