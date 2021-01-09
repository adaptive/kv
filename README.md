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
* KV_ACCESS_KEY_ID
* KV_SECRET_ACCESS_KEY 🔒
* KV_DEFAULT_REGION
* KV_S3_BUCKET

## 💻 Basic Usage

```javascript
const Namespace = new KV("namespace");

const handleRequest = async event => {

event.waitUntil(await Namespace.put("hello","world"));

```