// S3 signing behavior adapted from aws4fetch (Michael Hart, MIT).
// See THIRD_PARTY_NOTICES.md for the original license.
const encoder = new TextEncoder();
const unsignedHeaders = new Set([
  "authorization",
  "content-type",
  "content-length",
  "user-agent",
  "presigned-expires",
  "expect",
  "x-amzn-trace-id",
  "range",
  "connection",
]);

const rfc3986 = (value) =>
  value.replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const uriEncode = (value) => rfc3986(encodeURIComponent(value));
const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const hash = (value) =>
  crypto.subtle.digest(
    "SHA-256",
    typeof value === "string" ? encoder.encode(value) : value,
  );

async function hmac(key, value) {
  const imported = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value));
}

async function signRequest(input, init, options) {
  const url = new URL(input);
  const headers = new Headers(init.headers || {});
  const method = init.method || (init.body ? "POST" : "GET");
  const { accessKeyId, secretAccessKey, sessionToken } = options;
  if (accessKeyId == null)
    throw new TypeError("accessKeyId is a required option");
  if (secretAccessKey == null)
    throw new TypeError("secretAccessKey is a required option");
  const cache = options.cache || new Map();
  const service = options.service || "s3";
  const region = options.region || "us-east-1";
  const datetime =
    options.datetime || new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = datetime.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const signQuery = options.signQuery;
  const appendSessionToken =
    options.appendSessionToken || service === "iotdevicegateway";

  headers.delete("host");
  if (service === "s3" && !signQuery && !headers.has("x-amz-content-sha256")) {
    headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
  }
  const params = signQuery ? url.searchParams : headers;
  params.set("X-Amz-Date", datetime);
  if (sessionToken && !appendSessionToken)
    params.set("X-Amz-Security-Token", sessionToken);

  const names = ["host", ...headers.keys()]
    .filter((name) => options.allHeaders || !unsignedHeaders.has(name))
    .sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names
    .map(
      (name) =>
        `${name}:${name === "host" ? url.host : headers.get(name).replace(/\s+/g, " ")}`,
    )
    .join("\n");

  if (signQuery) {
    if (service === "s3" && !params.has("X-Amz-Expires"))
      params.set("X-Amz-Expires", "86400");
    params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    params.set("X-Amz-Credential", `${accessKeyId}/${scope}`);
    params.set("X-Amz-SignedHeaders", signedHeaders);
  }

  let path = url.pathname;
  if (service === "s3") {
    // S3 object names retain repeated slashes. Decode once before encoding once,
    // including aws4fetch's handling of literal '+' in existing endpoint paths.
    try {
      path = decodeURIComponent(path.replace(/\+/g, " "));
    } catch {
      // Preserve malformed percent escapes as literal path content.
    }
  } else {
    path = path.replace(/\/+/g, "/");
  }
  if (!options.singleEncode)
    path = encodeURIComponent(path).replace(/%2F/g, "/");
  path = rfc3986(path);

  const seen = new Set();
  const query = [...url.searchParams]
    .filter(([name]) => {
      if (!name || (service === "s3" && seen.has(name))) return false;
      seen.add(name);
      return true;
    })
    .map(([name, value]) => [uriEncode(name), uriEncode(value)])
    .sort(([a, av], [b, bv]) =>
      a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0,
    )
    .map((pair) => pair.join("="))
    .join("&");

  let payloadHash =
    headers.get("x-amz-content-sha256") ||
    (service === "s3" && signQuery ? "UNSIGNED-PAYLOAD" : null);
  if (payloadHash === null) {
    if (
      init.body &&
      typeof init.body !== "string" &&
      !("byteLength" in init.body)
    ) {
      throw new Error(
        "body must be a string, ArrayBuffer or ArrayBufferView, unless you include the X-Amz-Content-Sha256 header",
      );
    }
    payloadHash = hex(await hash(init.body || ""));
  }
  const canonical = [
    method.toUpperCase(),
    path,
    query,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const toSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    scope,
    hex(await hash(canonical)),
  ].join("\n");

  // Include all signing-key inputs so rotation and UTC date changes cannot reuse
  // a key derived for different credentials. Keep the public cache hook usable.
  const cacheKey = JSON.stringify([secretAccessKey, date, region, service]);
  let key = cache.get(cacheKey);
  if (!key) {
    key = await hmac(`AWS4${secretAccessKey}`, date);
    for (const value of [region, service, "aws4_request"])
      key = await hmac(key, value);
    cache.set(cacheKey, key);
  }
  const signature = hex(await hmac(key, toSign));
  if (signQuery) {
    params.set("X-Amz-Signature", signature);
    if (sessionToken && appendSessionToken)
      params.set("X-Amz-Security-Token", sessionToken);
  } else {
    headers.set(
      "Authorization",
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    );
  }
  const requestInit = { ...init, method, headers };
  delete requestInit.aws;
  try {
    return new Request(url, requestInit);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return new Request(url, { duplex: "half", ...requestInit });
  }
}

/** Fetch transport for KV; preserves the existing aws.sign/aws.fetch hooks. */
export class S3Client {
  constructor({ accessKeyId, secretAccessKey, region }) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
    this.service = "s3";
    this.sessionToken = undefined;
    this.cache = new Map();
    this.retries = 10;
    this.initRetryMs = 50;
  }

  async sign(input, init) {
    if (input instanceof Request) {
      const { method, headers, body } = input;
      init = { method, headers, ...init };
      if (init.body == null && headers.has("content-type")) {
        init.body =
          body !== null && headers.has("x-amz-content-sha256")
            ? body
            : await input.clone().arrayBuffer();
      }
      input = input.url;
    }
    init = init || {};
    return signRequest(input.toString(), init, { ...this, ...init.aws });
  }

  async fetch(input, init) {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const response = await fetch(await this.sign(input, init));
      if (
        attempt === this.retries ||
        (response.status < 500 && response.status !== 429)
      )
        return response;
      try {
        await response.body?.cancel();
      } catch {
        // A failed cleanup must not prevent retrying the storage request.
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * this.initRetryMs * 2 ** attempt),
      );
    }
    throw new Error(
      "An unknown error occurred, ensure retries is not negative",
    );
  }
}
