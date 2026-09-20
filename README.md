# KV Utility

[![npm](https://img.shields.io/npm/v/@adaptivelink/kv.svg)](https://www.npmjs.com/package/@adaptivelink/kv)

S3-backed key/value storage for Cloudflare Workers and other runtimes with Fetch and Web Crypto. Values can optionally be encrypted before they reach your storage provider.

## Install

```sh
npm install @adaptivelink/kv
# or
pnpm add @adaptivelink/kv
```

## Configure

Pass configuration explicitly when creating a namespace:

```js
import KV from "@adaptivelink/kv";

const namespace = new KV("settings", {
  endpoint: "https://my-bucket.s3.eu-west-1.amazonaws.com",
  accessKeyId: "YOUR_ACCESS_KEY_ID",
  secretAccessKey: "YOUR_SECRET_ACCESS_KEY",
  region: "eu-west-1",
});
```

Load real credentials from your runtime's secret bindings. The `endpoint` is the full bucket URL: either a bucket hostname or a path-style URL such as `https://s3.example.com/my-bucket`. A trailing slash is optional. HTTPS is recommended; HTTP is supported for local S3-compatible services. Credentials, queries and fragments are not allowed in endpoint URLs.

| Option            | Purpose                                                                      |
| ----------------- | ---------------------------------------------------------------------------- |
| `endpoint`        | Full bucket URL, including an optional bucket path                           |
| `accessKeyId`     | S3 access key ID                                                             |
| `secretAccessKey` | S3 secret access key                                                         |
| `region`          | Region used for S3 request signing                                           |
| `passphrase`      | Optional non-empty encryption secret; `null` or omission disables encryption |

The namespace defaults to `"main"`. The first four options are required unless supplied through the legacy globals described below.

## Cloudflare Workers

Module Workers receive bindings through the handler's `env` argument. Configure `KV_ENDPOINT` and `KV_DEFAULT_REGION` as variables; configure `KV_ACCESS_KEY_ID`, `KV_SECRET_ACCESS_KEY`, and the optional `KV_NAMESPACE_PASSPHRASE` as secrets. See Cloudflare's [environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/) and [secrets](https://developers.cloudflare.com/workers/configuration/secrets/) documentation.

```js
import KV from "@adaptivelink/kv";

export default {
  async fetch(request, env, ctx) {
    const namespace = new KV("settings", {
      endpoint: env.KV_ENDPOINT,
      accessKeyId: env.KV_ACCESS_KEY_ID,
      secretAccessKey: env.KV_SECRET_ACCESS_KEY,
      region: env.KV_DEFAULT_REGION,
      passphrase: env.KV_NAMESPACE_PASSPHRASE,
    });

    // Await a write before reporting that it succeeded.
    await namespace.put("hello", "world");
    const value = await namespace.get("hello");

    // Pass the promise directly for work that can finish after the response.
    ctx.waitUntil(namespace.put("last-read", new Date().toISOString()));
    return new Response(value);
  },
};
```

## Read, write and delete

```js
await namespace.put("hello", "world"); // true
await namespace.get("hello"); // "world"
await namespace.put("empty"); // stores an empty string
await namespace.get("absent"); // null
await namespace.delete("hello"); // true
await namespace.delete("absent"); // true (idempotent)
```

`put()` accepts strings. Serialize structured data explicitly:

```js
await namespace.put("preferences", JSON.stringify({ theme: "dark" }));
const preferences = await namespace.get("preferences", "json");
// { theme: "dark" }
```

A missing JSON value also returns `null`. Malformed JSON throws a `SyntaxError`. TypeScript callers can specify the expected shape; this does not validate the stored data at runtime:

```ts
const preferences = await namespace.get<{ theme: string }>(
  "preferences",
  "json",
);
console.log(preferences?.theme);
```

Namespaces and keys must be non-empty strings. Slashes preserve folder structure; spaces, Unicode, `%`, `?`, `#`, and other special characters are encoded as literal key content. Standalone `.` and `..` path segments are rejected to prevent URL normalization from changing the object being addressed. For example, `folder/item` is valid but `folder/../item` is not.

## Errors

Storage errors throw `KVError` with `status` and `method` properties. Only `get()` and `delete()` treat HTTP 404 as an expected missing key. A provider that returns 403 for missing objects will still produce an error; check your bucket permissions if you expect 404 responses.

```js
import { KVError } from "@adaptivelink/kv";

try {
  await namespace.put("hello", "world");
} catch (error) {
  if (error instanceof KVError) {
    console.error(error.method, error.status);
  }
  throw error;
}
```

Invalid arguments throw `TypeError`; network and encryption failures propagate as errors. Provider response bodies are not included in `KVError` messages.

## Encryption and compatibility

Set `passphrase` to encrypt values with AES-GCM. Encrypted objects keep the existing `.enc` suffix and the original format (a 12-byte random IV encoded as 24 hex characters, followed by base64 ciphertext and its authentication tag). Existing encrypted values remain readable. Plain and encrypted values occupy separate object names; changing the passphrase or toggling encryption does not migrate stored data.

For compatibility, encryption still derives its key with SHA-256. Use a high-entropy generated secret, rather than a human-chosen password. Namespace and key names remain visible to the storage provider; only values are encrypted. Keep encryption secrets available for as long as you need to read their values.

Legacy service-worker-style global configuration is also supported:

- `KV_S3_BUCKET`: bucket hostname with an optional path, **without** `https://`.
- `KV_ACCESS_KEY_ID`: access key ID.
- `KV_SECRET_ACCESS_KEY`: secret access key.
- `KV_DEFAULT_REGION`: signing region.

Explicit constructor options take precedence over these globals. As before, `KV_NAMESPACE_PASSPHRASE` must be passed explicitly as `passphrase`; it is not picked up automatically.

```js
const namespace = new KV("settings", {
  passphrase: KV_NAMESPACE_PASSPHRASE,
});
```

### Updating from 0.2.2

- Failed storage requests now reject instead of reporting success or returning error bodies.
- Missing reads return `null`; deletion of a missing key succeeds.
- `get(key, "json")` now returns parsed JSON.
- Unencrypted deletion targets the correct object, without the old `undefined` suffix.
- Keys containing URL-special characters now target their literal S3 names. Objects written through the old URL interpolation may require migration to those names.
- Keys, namespaces and write values are validated; serialize objects before writing. Empty encryption secrets are rejected.
- Package entry points now explicitly support ESM, including the existing `dist/kv.esm.js` import path. TypeScript declarations describe the public API.

## Development

Use Node.js 26.9.0 (pinned in `.node-version`) and pnpm 12.5.1 (pinned in `package.json`). The development container uses Node.js 26; CI also checks compatibility with Node.js 22 and 24.

```sh
npm install --global pnpm@12.5.1
pnpm install --frozen-lockfile
pnpm run check
pnpm run dry-run
```

`check` verifies formatting, builds the distribution, runs the regression tests, and checks TypeScript consumer examples. To test while editing, run `pnpm run build` followed by `pnpm test`. Run `pnpm run format` to apply formatting.

Tests use mocked storage responses, exercise actual `aws4fetch` request signing, and include a ciphertext fixture generated by the original implementation. They do not contact a live storage provider.

The release workflow installs from the frozen lockfile and runs the checks before publishing. Packing also rebuilds the distribution through `prepack`. Update the package version before creating a GitHub release; publishing uses the repository's `NPM_TOKEN` secret.
