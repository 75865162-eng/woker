import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const keyName = "AMAZON_ADS_ENCRYPTION_KEY";

export type AdsCredentialScope = { organizationId: string; workspaceId: string; authorizationId: string };

function encryptionKey(environment: Record<string, string | undefined> = process.env) {
  const encoded = environment[keyName]?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? key : null;
}

export function hasAmazonAdsEncryptionKey(environment?: Record<string, string | undefined>) {
  return encryptionKey(environment) !== null;
}

function aad(scope: AdsCredentialScope) {
  return Buffer.from(JSON.stringify([scope.organizationId, scope.workspaceId, scope.authorizationId]));
}

export function encryptAmazonAdsCheckpoint(value: unknown, scope: AdsCredentialScope, taskId: string, environment?: Record<string, string | undefined>) {
  const key = encryptionKey(environment);
  if (!key) throw new Error(`服务器缺少有效的 ${keyName}（32 字节 Base64 密钥）。`);
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.concat([aad(scope), Buffer.from(taskId)]));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptAmazonAdsCheckpoint<T>(value: string | null, scope: AdsCredentialScope, taskId: string, environment?: Record<string, string | undefined>): T | null {
  if (!value) return null;
  const key = encryptionKey(environment);
  if (!key) throw new Error(`服务器缺少有效的 ${keyName}（32 字节 Base64 密钥）。`);
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, extra] = value.split(".");
    if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag || extra) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(Buffer.concat([aad(scope), Buffer.from(taskId)]));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8")) as T;
  } catch { throw new Error("Amazon Ads 同步检查点无法解密。未向 Amazon 发起请求。"); }
}

export function encryptAmazonAdsRefreshToken(refreshToken: string, scope: AdsCredentialScope, environment?: Record<string, string | undefined>) {
  const key = encryptionKey(environment);
  if (!key) throw new Error(`服务器缺少有效的 ${keyName}（32 字节 Base64 密钥）。`);
  if (!refreshToken.trim() || refreshToken.length > 16384) throw new Error("Amazon Ads refresh token 无效。");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptAmazonAdsRefreshToken(value: string, scope: AdsCredentialScope, environment?: Record<string, string | undefined>) {
  const key = encryptionKey(environment);
  if (!key) throw new Error(`服务器缺少有效的 ${keyName}（32 字节 Base64 密钥）。`);
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, extra] = value.split(".");
    if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag || extra) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
    if (!plaintext || plaintext.length > 16384) throw new Error();
    return plaintext;
  } catch {
    throw new Error("已保存的 Amazon Ads 凭证无法解密；请检查 Ads 加密主密钥。未向 Amazon 发起请求。");
  }
}
