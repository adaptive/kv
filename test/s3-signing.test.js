import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import KV from "../src/main.js";

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/s3-signing.json", import.meta.url),
    "utf8",
  ),
);

const config = {
  endpoint: "https://bucket.example.com",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "eu-west-1",
};

test("S3 SigV4 signing matches aws4fetch compatibility fixtures", async (t) => {
  for (const { id, input, expected } of fixture.cases) {
    await t.test(id, async () => {
      const kv = new KV("namespace", {
        endpoint: "https://bucket.example.com",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
        region: input.region,
      });
      if (input.sessionToken) kv.aws.sessionToken = input.sessionToken;

      const request = await kv.aws.sign(input.url, {
        method: input.method,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        aws: {
          datetime: input.datetime,
          ...(input.signQuery ? { signQuery: true } : {}),
        },
      });

      assert.equal(request.url, expected.url);
      assert.equal(request.method, expected.method);
      assert.deepEqual(
        Object.fromEntries([...request.headers.entries()].sort()),
        expected.headers,
      );
      assert.equal(request.body ? await request.text() : null, expected.body);
    });
  }
});

test("signing Request inputs preserves bodies and does not mutate caller headers", async () => {
  const { input, expected } = fixture.cases.find(
    ({ id }) => id === "unicode-put",
  );
  const kv = new KV("namespace", config);
  const original = new Request(input.url, {
    method: input.method,
    body: input.body,
  });
  const init = { aws: { datetime: input.datetime } };
  for (let attempt = 0; attempt < 2; attempt++) {
    const signed = await kv.aws.sign(original, init);
    assert.deepEqual(Object.fromEntries(signed.headers), expected.headers);
    assert.equal(await signed.text(), expected.body);
  }
  assert.equal(original.headers.has("authorization"), false);
  assert.equal(original.headers.has("x-amz-date"), false);
  assert.equal(original.bodyUsed, false);
  assert.equal(await original.text(), input.body);
  assert.deepEqual(init, { aws: { datetime: input.datetime } });
});

test("cached signing keys respect credential rotation, region and UTC date", async () => {
  const kv = new KV("namespace", config);
  const url = "https://bucket.example.com/namespace/key";
  const initial = await kv.aws.sign(url, {
    aws: { datetime: "20261106T235959Z" },
  });
  const sharedCache = kv.aws.cache;
  for (const [secretAccessKey, region, datetime] of [
    ["rotated-secret", "eu-west-1", "20261106T235959Z"],
    ["rotated-secret", "us-east-1", "20261106T235959Z"],
    ["rotated-secret", "us-east-1", "20261107T000000Z"],
  ]) {
    kv.aws.secretAccessKey = secretAccessKey;
    kv.aws.region = region;
    const fresh = new KV("namespace", { ...config, secretAccessKey, region });
    const options = { aws: { datetime } };
    const actual = await kv.aws.sign(url, options);
    const expected = await fresh.aws.sign(url, options);
    assert.equal(
      actual.headers.get("authorization"),
      expected.headers.get("authorization"),
    );
    assert.notEqual(
      actual.headers.get("authorization"),
      initial.headers.get("authorization"),
    );
    assert.equal(kv.aws.cache, sharedCache);
  }
});

test("per-request credential overrides validate and leave client defaults intact", async () => {
  const kv = new KV("namespace", config);
  const { input, expected } = fixture.cases.find(
    ({ id }) => id === "simple-get",
  );
  for (const property of ["accessKeyId", "secretAccessKey"]) {
    for (const value of [null, undefined]) {
      await assert.rejects(
        kv.aws.sign(input.url, { aws: { [property]: value } }),
        TypeError,
      );
    }
  }
  // An absent override cache still uses a fresh cache, as in the old transport.
  const signed = await kv.aws.sign(input.url, {
    aws: { datetime: input.datetime, cache: undefined },
  });
  assert.equal(
    signed.headers.get("authorization"),
    expected.headers.authorization,
  );
  assert.equal(kv.aws.accessKeyId, config.accessKeyId);
  assert.equal(kv.aws.secretAccessKey, config.secretAccessKey);
});
