import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SyncScope } from "./policy";
function key() {
  const value = process.env.AMAZON_SP_API_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, "base64").length !== 32) throw new Error("同步检查点需要有效的服务器加密密钥。");
  return Buffer.from(value, "base64");
}
function aad(scope: SyncScope, taskId: string) { return Buffer.from(JSON.stringify(["amazon-sync-page.v1", scope.organizationId, scope.workspaceId, taskId])); }
export function encryptCheckpoint(token: string | undefined, scope: SyncScope, taskId: string): string | null {
  if (!token) return null;
  if (token.length > 32000) throw new Error("分页 token 超出安全长度限制。");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(scope, taskId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
export function decryptCheckpoint(value: string | null, scope: SyncScope, taskId: string): string | undefined {
  if (!value) return undefined;
  try {
    const [v, iv, data, tag, extra] = value.split(".");
    if (v !== "v1" || !iv || !data || !tag || extra) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAAD(aad(scope, taskId)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("同步检查点无法解密；请重新开始完整快照。"); }
}
