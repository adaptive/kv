import { AwsClient } from "aws4fetch";

/**
 * @author Hugo Romano <adaptive@hey.com>
 */
const KV = class {
  /**
   * @param {string} namespace - namespace id
   */
  constructor(namespace = "main", config = { passphrase: null }) {
    this.namespace = namespace;
    this.config = config;

    this.prefix = `https://${KV_S3_BUCKET}/${namespace}`;

    this.aws = new AwsClient({
      accessKeyId: KV_ACCESS_KEY_ID,
      secretAccessKey: KV_SECRET_ACCESS_KEY,
      region: KV_DEFAULT_REGION,
      service: "s3"
    });

    this.Encrypt = async (plaintext, password) => {
      const pwUtf8 = new TextEncoder().encode(password); // encode password as UTF-8
      const pwHash = await crypto.subtle.digest("SHA-256", pwUtf8); // hash the password
      const iv = crypto.getRandomValues(new Uint8Array(12)); // get 96-bit random iv
      const alg = { name: "AES-GCM", iv: iv }; // specify algorithm to use
      const key = await crypto.subtle.importKey("raw", pwHash, alg, false, [
        "encrypt"
      ]); // generate key from pw
      const ptUint8 = new TextEncoder().encode(plaintext); // encode plaintext as UTF-8
      const ctBuffer = await crypto.subtle.encrypt(alg, key, ptUint8); // encrypt plaintext using key
      const ctArray = Array.from(new Uint8Array(ctBuffer)); // ciphertext as byte array
      const ctStr = ctArray.map(byte => String.fromCharCode(byte)).join(""); // ciphertext as string
      const ctBase64 = btoa(ctStr); // encode ciphertext as base64
      const ivHex = Array.from(iv)
        .map(b => ("00" + b.toString(16)).slice(-2))
        .join(""); // iv as hex string
      return ivHex + ctBase64; // return iv+ciphertext
    };

    this.Decrypt = async (ciphertext, password) => {
      const pwUtf8 = new TextEncoder().encode(password); // encode password as UTF-8
      const pwHash = await crypto.subtle.digest("SHA-256", pwUtf8); // hash the password
      const iv = ciphertext
        .slice(0, 24)
        .match(/.{2}/g)
        .map(byte => parseInt(byte, 16)); // get iv from ciphertext
      const alg = { name: "AES-GCM", iv: new Uint8Array(iv) }; // specify algorithm to use
      const key = await crypto.subtle.importKey("raw", pwHash, alg, false, [
        "decrypt"
      ]); // use pw to generate key
      const ctStr = atob(ciphertext.slice(24)); // decode base64 ciphertext
      const ctUint8 = new Uint8Array(
        ctStr.match(/[\s\S]/g).map(ch => ch.charCodeAt(0))
      ); // ciphertext as Uint8Array
      // note: why doesn't ctUint8 = new TextEncoder().encode(ctStr) work?
      const plainBuffer = await crypto.subtle.decrypt(alg, key, ctUint8); // decrypt ciphertext using key
      const plaintext = new TextDecoder().decode(plainBuffer); // decode password from UTF-8
      return plaintext;
    };
  }
  /**
   * Put a KV value
   * @async
   * @arg {string} key - KV key
   * @arg {string} type - KV key to be deleted
   */
  async put(key, value = "", options = false) {
    if (!key) throw "missing key on .put()";
    if (this.config.passphrase != null) {
      let encrypted = await this.Encrypt(value, this.config.passphrase);
      await this.aws.fetch(`${this.prefix}/${key}.enc`, {
        body: encrypted,
        method: "PUT"
      });
    } else {
      await this.aws.fetch(`${this.prefix}/${key}`, {
        body: value,
        method: "PUT"
      });
    }

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
    let decrypted;
    if (this.config.passphrase != null) {
      let request = await this.aws.fetch(`${this.prefix}/${key}.enc`);
      let text = await request.text();
      decrypted = await this.Decrypt(text, this.config.passphrase);
    } else {
      let request = await this.aws.fetch(`${this.prefix}/${key}`);
      decrypted = await request.text();
    }
    return decrypted;
  }

  /**
   * Delete a KV
   * @async
   * @arg {string} key - KV key
   */
  async delete(key) {
    if (!key) throw "missing key on .delete()";
    let suffix;
    if (this.config.passphrase != null) {
      suffix = ".enc";
    }
    await this.aws.fetch(`${this.prefix}/${key}${suffix}`, {
      method: "DELETE"
    });
    return true;
  }
};

export default KV;
