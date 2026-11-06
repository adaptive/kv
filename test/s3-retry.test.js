import assert from "node:assert/strict";
import { test } from "node:test";
import KV, { KVError } from "../src/main.js";

const config = {
  endpoint: "https://bucket.example.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "us-east-1",
};

test("retries throttling and server responses with exponential jitter", async (t) => {
  const kv = new KV("retry", config);
  kv.aws.retries = 3;
  const attempts = [];
  const delays = [];
  const cancellations = [];
  let signingTime = 0;
  const dates = [
    "2026-02-28T23:59:59.000Z",
    "2026-03-01T00:00:01.000Z",
    "2026-03-01T00:00:02.000Z",
  ];
  t.mock.method(Math, "random", () => 0.5);
  t.mock.method(Date.prototype, "toISOString", () => dates[signingTime++]);
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    delays.push(delay);
    callback();
    return 0;
  });
  t.mock.method(globalThis, "fetch", async (request) => {
    attempts.push({
      authorization: request.headers.get("authorization"),
      date: request.headers.get("x-amz-date"),
    });
    const attempt = attempts.length;
    if (attempt < 3) {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("temporary"));
          },
          cancel() {
            cancellations.push(attempt);
            return Promise.reject(new Error("cleanup failed"));
          },
        }),
        { status: attempt === 1 ? 429 : 503 },
      );
    }
    return new Response("ready");
  });

  assert.equal(await kv.get("key"), "ready");
  assert.equal(attempts.length, 3);
  assert.deepEqual(delays, [25, 50]);
  assert.deepEqual(cancellations, [1, 2]);
  assert.deepEqual(
    attempts.map(({ date }) => date),
    ["20260228T235959Z", "20260301T000001Z", "20260301T000002Z"],
  );
  const authorizations = attempts.map(({ authorization }) => authorization);
  assert.ok(
    authorizations.every((authorization) =>
      authorization.startsWith("AWS4-HMAC-SHA256 "),
    ),
  );
  assert.match(
    authorizations[0],
    /Credential=[^,]+\/20260228\/us-east-1\/s3\/aws4_request/,
  );
  assert.match(
    authorizations[1],
    /Credential=[^,]+\/20260301\/us-east-1\/s3\/aws4_request/,
  );
  assert.notEqual(authorizations[0], authorizations[1]);
  assert.notEqual(authorizations[1], authorizations[2]);
});

test("a successful GET body stays readable and is not canceled", async (t) => {
  const kv = new KV("retry", config);
  kv.aws.retries = 1;
  let cancellations = 0;
  t.mock.method(globalThis, "setTimeout", (callback) => {
    callback();
    return 0;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("readable"));
            controller.close();
          },
          cancel() {
            cancellations += 1;
            return Promise.reject(new Error("successful body was canceled"));
          },
        }),
      ),
  );

  assert.equal(await kv.get("key"), "readable");
  assert.equal(cancellations, 0);
});

test("exhaustion makes eleven requests by default and reports the last status", async (t) => {
  const kv = new KV("retry", config);
  const requests = [];
  t.mock.method(Math, "random", () => 0);
  t.mock.method(globalThis, "setTimeout", (callback) => {
    callback();
    return 0;
  });
  t.mock.method(globalThis, "fetch", async (request) => {
    requests.push(request);
    return new Response("temporarily unavailable", { status: 503 });
  });

  await assert.rejects(kv.put("key", "value"), (error) => {
    assert.ok(error instanceof KVError);
    assert.equal(error.status, 503);
    assert.equal(error.method, "PUT");
    return true;
  });
  assert.equal(requests.length, 11);
});

test("retries replay the exact plaintext and encrypted request bodies", async (t) => {
  for (const passphrase of [null, "high-entropy-test-secret"]) {
    const kv = new KV("retry", { ...config, passphrase });
    kv.aws.retries = 1;
    const attempts = [];
    t.mock.method(globalThis, "setTimeout", (callback) => {
      callback();
      return 0;
    });
    t.mock.method(globalThis, "fetch", async (request) => {
      attempts.push({ url: request.url, body: await request.text() });
      return new Response(null, {
        status: attempts.length === 1 ? 500 : 200,
      });
    });

    assert.equal(await kv.put("key", "Olá 🌍"), true);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].url, attempts[1].url);
    assert.equal(attempts[0].body, attempts[1].body);
    if (passphrase === null) assert.equal(attempts[0].body, "Olá 🌍");
    else assert.equal(await kv.Decrypt(attempts[0].body, passphrase), "Olá 🌍");
  }
});

test("404, client errors, network errors and retries zero are not retried", async (t) => {
  const kv = new KV("retry", config);
  const requests = [];
  t.mock.method(globalThis, "setTimeout", () => {
    throw new Error("unexpected retry delay");
  });
  t.mock.method(globalThis, "fetch", async (request) => {
    requests.push(request);
    return new Response(null, {
      status: requests.length === 1 ? 404 : 403,
    });
  });

  assert.equal(await kv.get("missing"), null);
  await assert.rejects(kv.get("forbidden"), { status: 403 });
  assert.equal(requests.length, 2);

  kv.aws.retries = 0;
  requests.length = 0;
  t.mock.method(globalThis, "fetch", async (request) => {
    requests.push(request);
    return new Response("error", { status: 500 });
  });
  await assert.rejects(kv.delete("key"), { status: 500 });
  assert.equal(requests.length, 1);
});

test("network failures do not retry", async (t) => {
  const kv = new KV("retry", config);
  let requests = 0;
  t.mock.method(globalThis, "setTimeout", () => {
    throw new Error("unexpected retry delay");
  });
  t.mock.method(globalThis, "fetch", async () => {
    requests += 1;
    throw new TypeError("Network unavailable");
  });

  await assert.rejects(kv.get("key"), /Network unavailable/);
  assert.equal(requests, 1);
});
