# KV Utility

[![npm](https://img.shields.io/npm/v/@adaptivelink/kv.svg)](https://www.npmjs.com/package/@adaptivelink/kv)

KV storage solution for Cloudflare Worker and Stackpath Serverless Scripting that uses S3 providers as vendors.

## 🔨 Install with `yarn` or `npm`

```bash
yarn add @adaptivelink/kv
```

```bash
npm i @adaptivelink/kv
```

## ⚙️ Environment Variables
You need to configured the variables (Environment or Global) with your vendor data.

* KV_ACCESS_KEY_ID
* KV_SECRET_ACCESS_KEY 🔒
* KV_DEFAULT_REGION
* KV_S3_BUCKET

## 💻 Basic Usage in Coudflare & Stackpath

```javascript
import KV from "@adaptivelink/kv";

const NAMESPACE = new KV("namespace");

const handleRequest = async event => {

    event.waitUntil(await NAMESPACE.put("hello","world"));

}
```

## 💻 Methods

### Writing Key-value pair

`await NAMESPACE.put(key, value)`
