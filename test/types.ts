import KV, { KVError, type KVConfig } from "@adaptivelink/kv";

const config: KVConfig = {
  endpoint: "https://bucket.example.com",
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "us-east-1",
};
const kv = new KV("namespace", config);
const text: string | null = await kv.get("key");
const json = await kv.get<{ count: number }>("key", "json");
const count: number | undefined = json?.count;
const unknownJson: unknown = await kv.get("key", "json");
const saved: true = await kv.put("key", "value");
const deleted: true = await kv.delete("key");
const error: Error = new KVError(new Response(null, { status: 403 }), "GET");
void [text, count, unknownJson, saved, deleted, error];

// @ts-expect-error Unsupported read format.
kv.get("key", "binary");
// @ts-expect-error Callers must serialize JSON explicitly.
kv.put("key", { count: 1 });
// @ts-expect-error Keys must be strings.
kv.delete(123);
// @ts-expect-error Missing reads can be null.
const required: string = await kv.get("key");
void required;
