import KV, {
  KVError,
  type KVConfig,
  type KVRequestInit,
  type KVTransport,
} from "@adaptivelink/kv";

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

const transport: KVTransport = kv.aws;
const requestInit: KVRequestInit = {
  method: "GET",
  aws: { datetime: "20261106T120000Z", signQuery: true },
};
const signed: Request = await transport.sign(
  new URL(config.endpoint!),
  requestInit,
);
const response: Response = await transport.fetch(signed);
transport.retries = 0;
transport.fetch = async () => new Response("mocked");
void response;

// @ts-expect-error Unsupported read format.
kv.get("key", "binary");
// @ts-expect-error Callers must serialize JSON explicitly.
kv.put("key", { count: 1 });
// @ts-expect-error Keys must be strings.
kv.delete(123);
// @ts-expect-error Missing reads can be null.
const required: string = await kv.get("key");
void required;
