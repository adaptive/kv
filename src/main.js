import { AwsClient } from "aws4fetch";

/**
 * @author Hugo Romano <adaptive@hey.com>
 */
const KV = class {
  /**
   * @param {string} namespace - namespace id
   */
  constructor(namespace = "main") {
    this.namespace = namespace;
    this.prefix = `https://${KV_S3_BUCKET}/${namespace}`;
    this.aws = new AwsClient({
      accessKeyId: KV_ACCESS_KEY_ID,
      secretAccessKey: KV_SECRET_ACCESS_KEY,
      region: KV_DEFAULT_REGION,
      service: "s3"
    });
  }
  /**
   * Put a KV value
   * @async
   * @arg {string} key - KV key
   * @arg {string} type - KV key to be deleted
   */
  async put(key, value = "", options = false) {
    if (!key) throw "missing key on .put()";
    await this.aws.fetch(`${this.prefix}/${key}`, {
      body: value,
      method: "PUT"
    });
    return true;
  }

  /**
   * Get a KV value
   * @async
   * @arg {string} key - KV key
   * @arg {string} [type=text] - type of transformation
   */
  async get(key, type = "text") {
    //verification
    if (!key) throw "missing key on .get()";
    if (!["text", "json"].includes(type)) throw "invalid type on .get()";
    //verification
    const request = await this.aws.fetch(`${this.prefix}/${key}`);
    if (type === "text") {
      return request.text();
    } else if (type === "json") {
      return request.json();
    }
  }

  /**
   * Delete a KV
   * @async
   * @arg {string} key - KV key
   */
  async delete(key) {
    if (!key) throw "missing key on .delete()";
    await this.aws.fetch(`${this.prefix}/${key}`, {
      method: "DELETE"
    });
    return true;
  }
};

export default KV;
