import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import KV, { KVError } from "@adaptivelink/kv";
import LegacyPathKV from "@adaptivelink/kv/dist/kv.esm.js";

test("built package exports work and preserve the existing dist import path", async () => {
  assert.equal(KV, LegacyPathKV);
  const kv = new KV("package", {
    endpoint: "https://example.com/bucket",
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "us-east-1",
  });
  kv.aws.fetch = async () => new Response('{"ok":true}');
  assert.deepEqual(await kv.get("key", "json"), { ok: true });
  kv.aws.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(kv.put("key"), KVError);
  const sourceTypes = await readFile(
    new URL("../src/main.d.ts", import.meta.url),
    "utf8",
  );
  const builtTypes = await readFile(
    new URL("../dist/main.d.ts", import.meta.url),
    "utf8",
  );
  assert.equal(builtTypes, sourceTypes);
});
