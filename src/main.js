import { AwsClient } from "aws4fetch";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodePath(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value
    .split("/")
    .map((segment) => {
      // URL parsers normalize these even when their dots are percent-encoded.
      if (segment === "." || segment === "..") {
        throw new TypeError(`${name} cannot contain . or .. path segments`);
      }
      return encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    })
    .join("/");
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

async function encryptionKey(password, usage) {
  requiredString(password, "passphrase");
  // Preserve the original key derivation so existing encrypted values stay readable.
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [usage]);
}

/** An unsuccessful response from the storage provider. */
export class KVError extends Error {
  constructor(response, method) {
    super(
      `KV ${method} failed: ${response.status} ${response.statusText}`.trim(),
    );
    this.name = "KVError";
    this.status = response.status;
    this.method = method;
  }
}

/** S3-backed key/value storage for runtimes with Fetch and Web Crypto. */
export default class KV {
  constructor(namespace = "main", config = {}) {
    if (
      config === null ||
      typeof config !== "object" ||
      Array.isArray(config)
    ) {
      throw new TypeError("config must be an object");
    }

    const encodedNamespace = encodePath(namespace, "namespace");
    const legacyBucket =
      typeof KV_S3_BUCKET === "undefined" ? undefined : KV_S3_BUCKET;
    const endpoint =
      config.endpoint ?? (legacyBucket ? `https://${legacyBucket}` : undefined);
    const url = new URL(requiredString(endpoint, "endpoint"));
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError(
        "endpoint must be an HTTP(S) URL without credentials, a query, or a fragment",
      );
    }

    const accessKeyId =
      config.accessKeyId ??
      (typeof KV_ACCESS_KEY_ID === "undefined" ? undefined : KV_ACCESS_KEY_ID);
    const secretAccessKey =
      config.secretAccessKey ??
      (typeof KV_SECRET_ACCESS_KEY === "undefined"
        ? undefined
        : KV_SECRET_ACCESS_KEY);
    const region =
      config.region ??
      (typeof KV_DEFAULT_REGION === "undefined"
        ? undefined
        : KV_DEFAULT_REGION);
    const passphrase = config.passphrase ?? null;
    if (passphrase !== null) requiredString(passphrase, "passphrase");

    this.namespace = namespace;
    this.config = { ...config, passphrase };
    this.prefix = `${url.href.replace(/\/+$/, "")}/${encodedNamespace}`;
    this.aws = new AwsClient({
      accessKeyId: requiredString(accessKeyId, "accessKeyId"),
      secretAccessKey: requiredString(secretAccessKey, "secretAccessKey"),
      region: requiredString(region, "region"),
      service: "s3",
    });
  }

  /** Encrypt using the legacy 24-character IV hex + base64 ciphertext format. */
  async Encrypt(plaintext, password) {
    if (typeof plaintext !== "string")
      throw new TypeError("value must be a string");
    const key = await encryptionKey(password, "encrypt");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(plaintext),
      ),
    );
    let binary = "";
    // Bound each call's argument count for large values.
    for (let offset = 0; offset < encrypted.length; offset += 8192) {
      binary += String.fromCharCode(
        ...encrypted.subarray(offset, offset + 8192),
      );
    }
    const ivHex = Array.from(iv, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return ivHex + btoa(binary);
  }

  async Decrypt(ciphertext, password) {
    if (
      typeof ciphertext !== "string" ||
      !/^[\da-f]{24}[A-Za-z0-9+/]+={0,2}$/i.test(ciphertext)
    ) {
      throw new Error("Invalid encrypted KV value");
    }
    const iv = Uint8Array.from(ciphertext.slice(0, 24).match(/.{2}/g), (byte) =>
      parseInt(byte, 16),
    );
    let encrypted;
    try {
      encrypted = Uint8Array.from(atob(ciphertext.slice(24)), (character) =>
        character.charCodeAt(0),
      );
    } catch (cause) {
      throw new Error("Invalid encrypted KV value", { cause });
    }
    if (encrypted.length < 16) throw new Error("Invalid encrypted KV value");
    const key = await encryptionKey(password, "decrypt");
    return decoder.decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted),
    );
  }

  _url(key) {
    const suffix = this.config.passphrase === null ? "" : ".enc";
    return `${this.prefix}/${encodePath(key, "key")}${suffix}`;
  }

  async _request(url, method, body) {
    const response = await this.aws.fetch(url, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    if (
      !response.ok &&
      !(response.status === 404 && (method === "GET" || method === "DELETE"))
    ) {
      // Release the response stream without including provider bodies in errors.
      await response.body?.cancel();
      throw new KVError(response, method);
    }
    return response;
  }

  /** Store a string. Serialize objects with JSON.stringify before writing. */
  async put(key, value = "") {
    const url = this._url(key);
    if (typeof value !== "string")
      throw new TypeError("value must be a string");
    const body =
      this.config.passphrase === null
        ? value
        : await this.Encrypt(value, this.config.passphrase);
    const response = await this._request(url, "PUT", body);
    await response.body?.cancel();
    return true;
  }

  /** Return text or parsed JSON; missing keys return null. */
  async get(key, type = "text") {
    const url = this._url(key);
    if (type !== "text" && type !== "json")
      throw new TypeError('type must be "text" or "json"');
    const response = await this._request(url, "GET");
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    const stored = await response.text();
    const value =
      this.config.passphrase === null
        ? stored
        : await this.Decrypt(stored, this.config.passphrase);
    return type === "json" ? JSON.parse(value) : value;
  }

  /** Delete a value. Missing keys are already deleted and return true. */
  async delete(key) {
    const response = await this._request(this._url(key), "DELETE");
    await response.body?.cancel();
    return true;
  }
}
