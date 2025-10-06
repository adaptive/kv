import { createRequire } from "node:module";
import cleanup from "rollup-plugin-cleanup";
import terser from "@rollup/plugin-terser";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

export default {
  input: "src/main.js",
  output: [{ format: "esm", file: pkg.module }],
  plugins: [cleanup(), terser({ module: true, maxWorkers: 1 })],
  external: ["aws4fetch"]
};

