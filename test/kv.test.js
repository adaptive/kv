import assert from "node:assert/strict";
import { test } from "node:test";
import KV, { KVError } from "../src/main.js";

const config = {
  endpoint: "https://bucket.example.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "us-east-1",
};

function store(options = {}, namespace = "namespace") {
  const kv = new KV(namespace, { ...config, ...options });
  const objects = new Map();
  const calls = [];
  kv.aws.fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    if (init.method === "PUT") {
      objects.set(url, init.body);
      return new Response(null, { status: 200 });
    }
    if (init.method === "DELETE") {
      objects.delete(url);
      return new Response(null, { status: 204 });
    }
    return objects.has(url)
      ? new Response(objects.get(url))
      : new Response("NoSuchKey", { status: 404 });
  };
  return { kv, objects, calls };
}

for (const passphrase of [null, "high-entropy-test-secret"]) {
  const mode = passphrase === null ? "plain" : "encrypted";
  test(`${mode}: text, empty strings, JSON, missing reads and deletion`, async () => {
    const { kv, objects, calls } = store({ passphrase });
    assert.equal(await kv.get("absent"), null);
    assert.equal(await kv.get("absent", "json"), null);
    assert.equal(await kv.put("hello", "Olá 🌍"), true);
    assert.equal(await kv.get("hello"), "Olá 🌍");
    if (passphrase) assert.ok(![...objects.values()][0].includes("Olá"));
    assert.equal(await kv.put("empty"), true);
    assert.equal(await kv.get("empty"), "");
    await kv.put("json", JSON.stringify({ count: 2, label: "Olá" }));
    assert.deepEqual(await kv.get("json", "json"), { count: 2, label: "Olá" });
    await kv.put("invalid-json", "invalid");
    await assert.rejects(kv.get("invalid-json", "json"), SyntaxError);
    assert.equal(await kv.delete("hello"), true);
    assert.equal(
      calls.at(-1).url,
      `https://bucket.example.com/namespace/hello${passphrase ? ".enc" : ""}`,
    );
    assert.equal(await kv.get("hello"), null);
    assert.equal(await kv.delete("hello"), true);
  });

  for (const status of [400, 401, 403, 429, 500, 503]) {
    test(`${mode}: all operations reject HTTP ${status}`, async () => {
      const { kv } = store({ passphrase });
      kv.aws.fetch = async () =>
        new Response("provider-secret-details", { status });
      for (const [method, operation] of [
        ["GET", () => kv.get("key")],
        ["PUT", () => kv.put("key", "value")],
        ["DELETE", () => kv.delete("key")],
      ]) {
        await assert.rejects(operation, (error) => {
          assert.ok(error instanceof Error);
          assert.ok(error instanceof KVError);
          assert.equal(error.status, status);
          assert.equal(error.method, method);
          assert.ok(!error.message.includes("provider-secret-details"));
          return true;
        });
      }
    });
  }
}

test("404 is idempotent for deletion, but is an error for writes", async () => {
  const { kv } = store();
  kv.aws.fetch = async () => new Response("missing", { status: 404 });
  assert.equal(await kv.delete("key"), true);
  await assert.rejects(kv.put("key"), {
    name: "KVError",
    status: 404,
    method: "PUT",
  });
});

test("network failures propagate", async () => {
  const { kv } = store();
  const failure = new TypeError("Network unavailable");
  kv.aws.fetch = async () => {
    throw failure;
  };
  for (const operation of [
    () => kv.get("key"),
    () => kv.put("key"),
    () => kv.delete("key"),
  ]) {
    await assert.rejects(operation, (error) => error === failure);
  }
});

test("all operations use the same encoded key, namespace and endpoint path", async () => {
  const { kv, calls } = store(
    { endpoint: "https://example.com/bucket///" },
    "my namespace/日本",
  );
  const key = "folder/a?b#c %2F+!'()*\\\n";
  const expected =
    "https://example.com/bucket/my%20namespace/%E6%97%A5%E6%9C%AC/folder/a%3Fb%23c%20%252F%2B%21%27%28%29%2A%5C%0A";
  await kv.put(key, "value");
  assert.equal(await kv.get(key), "value");
  await kv.delete(key);
  assert.ok(calls.every(({ url }) => url === expected));
  assert.equal(new URL(expected).search, "");
  assert.equal(new URL(expected).hash, "");
});

test("real aws4fetch signing preserves special keys on the Fetch request", async (t) => {
  const kv = new KV("namespace", config);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (request) => {
    requests.push(request);
    return new Response("value");
  });
  const key = "folder/a?b#c %2F+!'()*";
  await kv.put(key, "value");
  await kv.get(key);
  await kv.delete(key);
  const expected =
    "https://bucket.example.com/namespace/folder/a%3Fb%23c%20%252F%2B%21%27%28%29%2A";
  assert.deepEqual(
    requests.map((request) => request.method),
    ["PUT", "GET", "DELETE"],
  );
  for (const request of requests) {
    assert.equal(request.url, expected);
    assert.match(request.headers.get("authorization"), /^AWS4-HMAC-SHA256 /);
  }
  assert.equal(await requests[0].text(), "value");
});

test("invalid keys, values and read types fail before a request", async () => {
  const { kv, calls } = store();
  for (const key of [
    undefined,
    null,
    "",
    1,
    {},
    ".",
    "..",
    "folder/../key",
    "folder/./key",
  ]) {
    for (const operation of [
      () => kv.get(key),
      () => kv.put(key),
      () => kv.delete(key),
    ]) {
      await assert.rejects(operation, TypeError);
    }
  }
  await assert.rejects(kv.get("key", "binary"), TypeError);
  await assert.rejects(kv.put("key", {}), TypeError);
  assert.equal(calls.length, 0);
});

test("constructor validates configuration and namespaces", () => {
  assert.equal(new KV(undefined, config).namespace, "main");
  for (const namespace of ["", null, 1, "../namespace", "a/./b"]) {
    assert.throws(() => new KV(namespace, config), TypeError);
  }
  for (const invalid of [null, 1, [], "config"]) {
    assert.throws(() => new KV("namespace", invalid), TypeError);
  }
  for (const property of [
    "endpoint",
    "accessKeyId",
    "secretAccessKey",
    "region",
    "passphrase",
  ]) {
    assert.throws(
      () => new KV("namespace", { ...config, [property]: "" }),
      TypeError,
    );
  }
  for (const endpoint of [
    "ftp://example.com",
    "https://user:secret@example.com",
    "https://example.com/?query",
    "https://example.com/#fragment",
  ]) {
    assert.throws(
      () => new KV("namespace", { ...config, endpoint }),
      TypeError,
    );
  }
});

test("legacy global configuration works and explicit options take precedence", () => {
  const legacy = {
    KV_S3_BUCKET: "legacy.example.com/bucket",
    KV_ACCESS_KEY_ID: "legacy-access",
    KV_SECRET_ACCESS_KEY: "legacy-secret",
    KV_DEFAULT_REGION: "legacy-region",
  };
  const descriptors = Object.fromEntries(
    Object.keys(legacy).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  try {
    Object.assign(globalThis, legacy);
    const kv = new KV();
    assert.equal(kv.prefix, "https://legacy.example.com/bucket/main");
    assert.equal(kv.aws.accessKeyId, "legacy-access");
    assert.equal(kv.aws.region, "legacy-region");
    const explicit = new KV("namespace", config);
    assert.equal(explicit.prefix, "https://bucket.example.com/namespace");
    assert.equal(explicit.aws.accessKeyId, config.accessKeyId);
    assert.equal(explicit.aws.region, config.region);
  } finally {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("encrypted values use random IVs and reject corruption and wrong secrets", async () => {
  const { kv } = store();
  const secret = "test-secret";
  const first = await kv.Encrypt("value", secret);
  const second = await kv.Encrypt("value", secret);
  assert.notEqual(first, second);
  assert.equal(await kv.Decrypt(first, secret), "value");
  await assert.rejects(kv.Decrypt(first, "wrong-secret"));
  const corrupted =
    first.slice(0, 24) + (first[24] === "A" ? "B" : "A") + first.slice(25);
  await assert.rejects(kv.Decrypt(corrupted, secret));
  for (const invalid of [
    "",
    "not ciphertext",
    "0".repeat(24),
    "0".repeat(24) + "AA==",
    "0".repeat(24) + "A",
    null,
  ]) {
    await assert.rejects(
      kv.Decrypt(invalid, secret),
      /Invalid encrypted KV value/,
    );
  }
  const large = "🌍".repeat(100_000);
  assert.equal(
    await kv.Decrypt(await kv.Encrypt(large, secret), secret),
    large,
  );
});

test("reads a ciphertext produced by the original implementation", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/legacy.json", import.meta.url), "utf8"),
  );
  const { kv, objects } = store({ passphrase: fixture.password });
  objects.set(
    "https://bucket.example.com/namespace/legacy.enc",
    fixture.ciphertext,
  );
  assert.equal(await kv.get("legacy"), fixture.plaintext);
});
