/** Per-request overrides for the signing transport. */
export interface KVSigningOptions {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  service?: string;
  region?: string;
  cache?: Map<string, ArrayBuffer>;
  datetime?: string;
  signQuery?: boolean;
  appendSessionToken?: boolean;
  allHeaders?: boolean;
  singleEncode?: boolean;
}

export type KVRequestInit = RequestInit & { aws?: KVSigningOptions };

/** Signing and fetch hooks exposed by KV's built-in transport. */
export interface KVTransport {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
  service: string | undefined;
  region: string | undefined;
  cache: Map<string, ArrayBuffer>;
  /** Number of retries after the first attempt; defaults to 10. */
  retries: number;
  /** Base delay for exponential full-jitter retries; defaults to 50 ms. */
  initRetryMs: number;
  sign(
    input: Request | { toString(): string },
    init?: KVRequestInit | null,
  ): Promise<Request>;
  fetch(
    input: Request | { toString(): string },
    init?: KVRequestInit | null,
  ): Promise<Response>;
}

export interface KVConfig {
  /** Bucket URL, optionally including a path (for path-style S3 endpoints). */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  /** Null or omitted disables encryption. Use a high-entropy, non-empty secret. */
  passphrase?: string | null;
}

export class KVError extends Error {
  constructor(response: Response, method: string);
  readonly status: number;
  readonly method: string;
}

export default class KV {
  constructor(namespace?: string, config?: KVConfig);
  namespace: string;
  config: KVConfig & { passphrase: string | null };
  prefix: string;
  aws: KVTransport;
  /** Store a string, or an empty string when value is omitted. */
  put(key: string, value?: string): Promise<true>;
  /** Missing keys return null. */
  get(key: string, type?: "text"): Promise<string | null>;
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  get(key: string, type: "text" | "json"): Promise<unknown>;
  /** Idempotent: missing keys also return true. */
  delete(key: string): Promise<true>;
  Encrypt(plaintext: string, password: string): Promise<string>;
  Decrypt(ciphertext: string, password: string): Promise<string>;
}
