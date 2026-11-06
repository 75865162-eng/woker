import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SellfoxCredentialScope = { organizationId: string; workspaceId: string };
export type SellfoxCredentials = { clientId: string; clientSecret: string };
export class SellfoxCredentialError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "SellfoxCredentialError"; }
}

type Environment = Record<string, string | undefined>;
function key(environment: Environment) {
  const encoded = environment.SELLFOX_CREDENTIAL_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;
  const value = Buffer.from(encoded, "base64");
  return value.length === 32 && value.toString("base64") === encoded ? value : null;
}
export function sellfoxEncryptionReady(environment: Environment = process.env) { return key(environment) !== null; }
function aad(scope: SellfoxCredentialScope) {
  if (!scope.organizationId || !scope.workspaceId) throw new SellfoxCredentialError("缺少有效的赛狐凭据范围。");
  return Buffer.from(JSON.stringify(["sellfox", scope.organizationId, scope.workspaceId]));
}
export function mergeSellfoxCredentials(submitted: unknown, existing: SellfoxCredentials | null): SellfoxCredentials {
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) throw new SellfoxCredentialError("凭据格式无效。");
  const value = submitted as Record<string, unknown>;
  const result = { clientId: "", clientSecret: "" };
  let changed = false;
  for (const field of ["clientId", "clientSecret"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > 16_384 || /[\u0000-\u001f\u007f]/.test(value[field]))) throw new SellfoxCredentialError("凭据字段格式或长度无效。");
    const input = typeof value[field] === "string" ? value[field].trim() : "";
    changed ||= Boolean(input);
    result[field] = input || existing?.[field] || "";
    if (!result[field]) throw new SellfoxCredentialError(`请填写 ${field === "clientId" ? "Client ID" : "Client Secret"}。`);
  }
  if (!changed) throw new SellfoxCredentialError("请填写需要保存的凭据。");
  return result;
}
export function encryptSellfoxCredentials(credentials: SellfoxCredentials, scope: SellfoxCredentialScope, environment: Environment = process.env) {
  const secret = key(environment);
  if (!secret) throw new SellfoxCredentialError("服务端赛狐加密主密钥尚未配置，未保存凭据。", 503);
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secret, iv);
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
export function decryptSellfoxCredentials(value: string, scope: SellfoxCredentialScope, environment: Environment = process.env): SellfoxCredentials {
  const secret = key(environment);
  if (!secret) throw new SellfoxCredentialError("服务端赛狐加密主密钥尚未配置，未读取凭据。", 503);
  try {
    const [version, iv, ciphertext, tag, extra] = value.split(".");
    if (version !== "v1" || !iv || !ciphertext || !tag || extra) throw new Error("format");
    const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64url"));
    decipher.setAAD(aad(scope)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
    return mergeSellfoxCredentials(parsed, null);
  } catch { throw new SellfoxCredentialError("已保存的赛狐凭据无法解密，请核对原加密主密钥；未回退到旧凭据。", 503); }
}
