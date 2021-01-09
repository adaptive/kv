import pkg from "./package.json";
import cleanup from "rollup-plugin-cleanup";
import { terser } from "rollup-plugin-terser";

export default {
  input: "src/main.js",
  output: [{ format: "esm", file: pkg.module }],
  plugins: [cleanup(), terser()],
  external: ["aws4fetch"]
};
