import{AwsClient as t}from"aws4fetch";export default class{constructor(e="main",s={passphrase:null}){this.namespace=e,this.config=s,this.prefix=`https://${KV_S3_BUCKET}/${e}`,this.aws=new t({accessKeyId:KV_ACCESS_KEY_ID,secretAccessKey:KV_SECRET_ACCESS_KEY,region:KV_DEFAULT_REGION,service:"s3"}),this.Encrypt=async(t,e)=>{const s=(new TextEncoder).encode(e),i=await crypto.subtle.digest("SHA-256",s),a=crypto.getRandomValues(new Uint8Array(12)),r={name:"AES-GCM",iv:a},n=await crypto.subtle.importKey("raw",i,r,!1,["encrypt"]),c=(new TextEncoder).encode(t),o=await crypto.subtle.encrypt(r,n,c),h=Array.from(new Uint8Array(o)).map((t=>String.fromCharCode(t))).join(""),p=btoa(h);return Array.from(a).map((t=>("00"+t.toString(16)).slice(-2))).join("")+p},this.Decrypt=async(t,e)=>{const s=(new TextEncoder).encode(e),i=await crypto.subtle.digest("SHA-256",s),a=t.slice(0,24).match(/.{2}/g).map((t=>parseInt(t,16))),r={name:"AES-GCM",iv:new Uint8Array(a)},n=await crypto.subtle.importKey("raw",i,r,!1,["decrypt"]),c=atob(t.slice(24)),o=new Uint8Array(c.match(/[\s\S]/g).map((t=>t.charCodeAt(0)))),h=await crypto.subtle.decrypt(r,n,o);return(new TextDecoder).decode(h)}}async put(t,e="",s=!1){if(!t)throw"missing key on .put()";if(null!=this.config.passphrase){let s=await this.Encrypt(e,this.config.passphrase);await this.aws.fetch(`${this.prefix}/${t}.enc`,{body:s,method:"PUT"})}else await this.aws.fetch(`${this.prefix}/${t}`,{body:e,method:"PUT"});return!0}async get(t,e="text"){if(!t)throw"missing key on .get()";if(!["text","json"].includes(e))throw"invalid type on .get()";let s;if(null!=this.config.passphrase){let e=await this.aws.fetch(`${this.prefix}/${t}.enc`),i=await e.text();s=await this.Decrypt(i,this.config.passphrase)}else{let e=await this.aws.fetch(`${this.prefix}/${t}`);s=await e.text()}return s}async delete(t){if(!t)throw"missing key on .delete()";let e;return null!=this.config.passphrase&&(e=".enc"),await this.aws.fetch(`${this.prefix}/${t}${e}`,{method:"DELETE"}),!0}}
