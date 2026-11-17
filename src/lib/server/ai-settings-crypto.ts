import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * 静止加密 AI 模型 API Key。复用 AMAZON_SP_API_ENCRYPTION_KEY 主密钥，
 * 但使用独立的 AAD 命名空间，与 SP-API 凭证密文域分离，避免跨用途搬运。
 *
 * 密文格式：aiv1.<iv>.<ciphertext>.<tag>（base64url）
 * 无前缀的值按历史明文原样返回，保证旧数据向后兼容。
 */
const encryptionKeyName = "AMAZON_SP_API_ENCRYPTION_KEY";
const cipherPrefix = "aiv1";

export type AiSettingsCryptoScope = {
  organizationId: string;
  workspaceId: string;
};

function encryptionKey(environment: Record<string, string | undefined> = process.env): Buffer | null {
  const encoded = environment[encryptionKeyName]?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? key : null;
}

export function hasAiSettingsEncryptionKey(environment?: Record<string, string | undefined>) {
  return encryptionKey(environment) !== null;
}

function aad(scope: AiSettingsCryptoScope) {
  return Buffer.from(JSON.stringify([cipherPrefix, scope.organizationId, scope.workspaceId]));
}

export function encryptAiApiKey(
  plaintext: string,
  scope: AiSettingsCryptoScope,
  environment?: Record<string, string | undefined>,
): string {
  if (!plaintext) return "";
  const key = encryptionKey(environment);
  if (!key) throw new Error(`保存 AI 配置需要有效的 ${encryptionKeyName}（32 字节 Base64 密钥）。`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${cipherPrefix}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptAiApiKey(
  value: string,
  scope: AiSettingsCryptoScope,
  environment?: Record<string, string | undefined>,
): string {
  if (!value) return "";
  if (!value.startsWith(`${cipherPrefix}.`)) return value;

  const key = encryptionKey(environment);
  if (!key) throw new Error(`读取 AI 配置需要有效的 ${encryptionKeyName}（32 字节 Base64 密钥）。`);
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, extra] = value.split(".");
    if (version !== cipherPrefix || !encodedIv || !encodedCiphertext || !encodedTag || extra) {
      throw new Error("invalid ciphertext");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("已保存的 AI 模型密钥无法解密；请检查服务器加密主密钥是否正确。未向模型服务发起请求。");
  }
}
