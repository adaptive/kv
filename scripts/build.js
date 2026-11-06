import { copyFile, mkdir } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
await mkdir(dist, { recursive: true });
await Promise.all([
  copyFile(
    new URL("../src/main.js", import.meta.url),
    new URL("kv.esm.js", dist),
  ),
  copyFile(
    new URL("../src/main.d.ts", import.meta.url),
    new URL("main.d.ts", dist),
  ),
]);
