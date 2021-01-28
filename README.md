# KV Utility

[![npm](https://img.shields.io/npm/v/@adaptivelink/kv.svg)](https://www.npmjs.com/package/@adaptivelink/kv)

A KV storage solution for Cloudflare Workers and Stackpath Serverless Scripting, that uses S3 providers as vendors, like AWS, Wasabi. Optionally you can encrypt your values at rest.

## 🔨 Install with `yarn` or `npm`

```bash
yarn add @adaptivelink/kv
```

```bash
npm i @adaptivelink/kv
```

## ⚙️ Environment Variables

You need to configured the variables (Environment or Global) with your vendor data.

- KV_ACCESS_KEY_ID
- KV_SECRET_ACCESS_KEY 🔒
- KV_DEFAULT_REGION
- KV_S3_BUCKET
- KV_NAMESPACE_PASSPHRASE 🔒 (optional)

🔒 _Should be stored as environment encrypted variable, avoid global variable._

## 🔓 Basic Usage in Cloudflare & Stackpath

```javascript
import KV from "@adaptivelink/kv";

const NAMESPACE = new KV("namespace");

const handleRequest = async (event) => {
  const keyValue = await NAMESPACE.get("key");
  event.waitUntil(await NAMESPACE.put("hello", "world"));
};
```

## 🔐 Usage with Encrypted Values

```javascript
...
const NAMESPACE = new KV("namespace", {
  passphrase: KV_NAMESPACE_PASSPHRASE,
});
...
```

## 🔩 Methods

### Writing Key-value pair

`await NAMESPACE.put(key, value)`

### Reading Key-value pair

`await NAMESPACE.get(key)`

### Deleting Key-value pair

`await NAMESPACE.get(key)`

🌐 Tested Vendors

|Vendor|Data Consistency|
|---|---|
|[AWS S3](https://aws.amazon.com/s3/)|[strong read-after-write](https://aws.amazon.com/s3/consistency/)|
|[Wasabi](https://wasabi.com/)|[subsecond read-after-write consistency](https://wasabi-support.zendesk.com/hc/en-us/articles/115001684591-What-data-consistency-model-does-Wasabi-employ-)|

## ⚠️ Security Disclaimer

This software offers no guarantees, we strongly advise that you audit the code.

When using encrypted KV option, only the values are encrypted with AES-GCM algorithm. That data is stored at the vendor encrypted, but encrypted/decrypted by the ⚙️ Worker script, meaning that the Isolate will have full access to the values. It would help if you referred to your serverless provider's terms to analyse their scope of access.

## 🥰 Contribution

Feel free to contribute with more features, documentation, and test with more vendors. Send your feedback.