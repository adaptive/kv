import { copyFile } from "node:fs/promises";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/main.js",
  output: [{ format: "esm", file: "dist/kv.esm.js" }],
  plugins: [
    terser({ module: true, maxWorkers: 1 }),
    {
      name: "copy-types",
      writeBundle: () => copyFile("src/main.d.ts", "dist/main.d.ts"),
    },
  ],
  external: ["aws4fetch"],
};
