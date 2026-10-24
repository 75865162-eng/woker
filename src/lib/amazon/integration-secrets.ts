import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonSpApiScopeAllowed, getAmazonSpApiConfigurationStatus, getAmazonSpApiServerConfiguration, type AmazonSpApiAllowedScope, type AmazonSpApiConfigurationStatus, type AmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";

const encryptionKeyName = "AMAZON_SP_API_ENCRYPTION_KEY";
const requiredCredentialFields = ["lwaClientId", "lwaClientSecret", "refreshToken"] as const;
const credentialLabels: Record<(typeof requiredCredentialFields)[number], string> = {
  lwaClientId: "LWA Client ID",
  lwaClientSecret: "LWA Client Secret",
  refreshToken: "Refresh Token",
};

export type AmazonSpApiCredentials = Pick<AmazonSpApiServerConfiguration, "lwaClientId" | "lwaClientSecret" | "refreshToken" | "awsAccessKeyId" | "awsSecretAccessKey" | "awsSessionToken">;
export type AmazonSpApiSettings = AmazonSpApiCredentials & { region: string; endpoint: string };

function encryptionKey(environment: Record<string, string | undefined> = process.env) {
  const encoded = environment[encryptionKeyName]?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? key : null;
}

export function hasAmazonSpApiEncryptionKey(environment?: Record<string, string | undefined>) {
  return encryptionKey(environment) !== null;
}

function aad(scope: AmazonSpApiAllowedScope) {
  return Buffer.from(JSON.stringify([scope.organizationId, scope.workspaceId]));
}

export function encryptAmazonSpApiCredentials(credentials: AmazonSpApiCredentials, scope: AmazonSpApiAllowedScope, environment?: Record<string, string | undefined>) {
  const key = encryptionKey(environment);
  if (!key) throw new Error(`服务器缺少有效的 ${encryptionKeyName}（32 字节 Base64 密钥）。`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptAmazonSpApiCredentials(value: string, scope: AmazonSpApiAllowedScope, environment?: Record<string, string | undefined>): AmazonSpApiCredentials {
  const key = encryptionKey(environment);
  if (!key) throw new Error(`服务器缺少有效的 ${encryptionKeyName}（32 字节 Base64 密钥）。`);
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, extra] = value.split(".");
    if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag || extra) throw new Error("invalid ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    for (const field of requiredCredentialFields) if (typeof parsed[field] !== "string" || !parsed[field]) throw new Error("invalid credential payload");
    return {
      lwaClientId: parsed.lwaClientId as string,
      lwaClientSecret: parsed.lwaClientSecret as string,
      refreshToken: parsed.refreshToken as string,
      awsAccessKeyId: typeof parsed.awsAccessKeyId === "string" ? parsed.awsAccessKeyId : "",
      awsSecretAccessKey: typeof parsed.awsSecretAccessKey === "string" ? parsed.awsSecretAccessKey : "",
      awsSessionToken: typeof parsed.awsSessionToken === "string" && parsed.awsSessionToken ? parsed.awsSessionToken : undefined,
    };
  } catch {
    throw new Error("已保存的 Amazon 凭证无法解密；请检查服务器加密主密钥是否正确。未向 Amazon 发起请求。");
  }
}

function validateEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("SP-API endpoint 必须是有效的 HTTPS 地址。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SP-API endpoint 必须是无路径、无凭据的 HTTPS 服务地址。");
  return url.origin;
}

export function validateAmazonSpApiSettings(input: AmazonSpApiSettings) {
  for (const field of requiredCredentialFields) if (!input[field].trim()) throw new Error(`请填写 ${credentialLabels[field]}。`);
  if (input.awsSessionToken && input.awsSessionToken.length > 8192) throw new Error("AWS Session Token 超出长度限制。");
  const region = input.region.trim();
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error("AWS Region 格式无效。");
  return { ...input, ...Object.fromEntries(requiredCredentialFields.map((field) => [field, input[field].trim()])), awsSessionToken: input.awsSessionToken?.trim() || undefined, region, endpoint: validateEndpoint(input.endpoint.trim()) } as AmazonSpApiSettings;
}

export async function getAmazonSpApiSettings(scope: AmazonSpApiAllowedScope): Promise<{ configured: boolean; missingEnvironmentVariables: string[]; region: string; endpoint: string; hasDatabaseCredentials: boolean; hasEncryptionKey: boolean; configurationError?: string }> {
  const record = process.env.DATABASE_URL ? await prisma.amazonIntegrationSecret.findUnique({ where: { organizationId_workspaceId: scope } }) : null;
  const hasEncryptionKey = hasAmazonSpApiEncryptionKey();
  if (record) {
    try { decryptAmazonSpApiCredentials(record.credentialsCiphertext, scope); }
    catch (error) { return { configured: false, missingEnvironmentVariables: [], region: record.awsRegion, endpoint: record.endpoint, hasDatabaseCredentials: true, hasEncryptionKey, configurationError: error instanceof Error ? error.message : "加密凭证不可用。" }; }
    return { configured: true, missingEnvironmentVariables: [], region: record.awsRegion, endpoint: record.endpoint, hasDatabaseCredentials: true, hasEncryptionKey };
  }
  const status: AmazonSpApiConfigurationStatus = getAmazonSpApiConfigurationStatus();
  const environmentScopeAllowed = process.env.AMAZON_SP_API_ALLOWED_ORGANIZATION_ID?.trim() === scope.organizationId
    && process.env.AMAZON_SP_API_ALLOWED_WORKSPACE_ID?.trim() === scope.workspaceId;
  const missingEnvironmentVariables = status.configured
    ? environmentScopeAllowed ? [] : ["AMAZON_SP_API_ALLOWED_ORGANIZATION_ID", "AMAZON_SP_API_ALLOWED_WORKSPACE_ID"]
    : [];
  return { ...status, configured: status.configured && environmentScopeAllowed, missingEnvironmentVariables, endpoint: process.env.AMAZON_SP_API_ENDPOINT?.trim() || "https://sellingpartnerapi-na.amazon.com", hasDatabaseCredentials: false, hasEncryptionKey };
}

export async function getAmazonSpApiServerConfigurationForScope(scope: AmazonSpApiAllowedScope): Promise<AmazonSpApiServerConfiguration> {
  if (process.env.DATABASE_URL) {
    const record = await prisma.amazonIntegrationSecret.findUnique({ where: { organizationId_workspaceId: scope } });
    if (record) {
      const credentials = decryptAmazonSpApiCredentials(record.credentialsCiphertext, scope);
      const settings = validateAmazonSpApiSettings({ ...credentials, region: record.awsRegion, endpoint: record.endpoint });
      return { ...settings };
    }
  }
  assertAmazonSpApiScopeAllowed(scope);
  return getAmazonSpApiServerConfiguration();
}

export async function assertAmazonSpApiScopeCanUse(scope: AmazonSpApiAllowedScope) {
  const status = await getAmazonSpApiSettings(scope);
  if (!status.configured) throw new Error(status.configurationError || `SP-API 尚未配置：${status.missingEnvironmentVariables.join("、")}`);
  if (!status.hasDatabaseCredentials) assertAmazonSpApiScopeAllowed(scope);
}

export async function saveAmazonSpApiSettings(input: { scope: AmazonSpApiAllowedScope; actorUserId: string; settings: AmazonSpApiSettings }) {
  const settings = validateAmazonSpApiSettings(input.settings);
  const credentialsCiphertext = encryptAmazonSpApiCredentials(settings, input.scope);
  return prisma.amazonIntegrationSecret.upsert({
    where: { organizationId_workspaceId: input.scope },
    create: { ...input.scope, credentialsCiphertext, awsRegion: settings.region, endpoint: settings.endpoint, updatedByUserId: input.actorUserId },
    update: { credentialsCiphertext, awsRegion: settings.region, endpoint: settings.endpoint, updatedByUserId: input.actorUserId },
  });
}

export function mergeAmazonSpApiSettings(existing: AmazonSpApiCredentials | null, submitted: Partial<AmazonSpApiSettings>): AmazonSpApiSettings {
  const merged = {
    lwaClientId: submitted.lwaClientId?.trim() || existing?.lwaClientId || "",
    lwaClientSecret: submitted.lwaClientSecret?.trim() || existing?.lwaClientSecret || "",
    refreshToken: submitted.refreshToken?.trim() || existing?.refreshToken || "",
    awsAccessKeyId: submitted.awsAccessKeyId?.trim() || existing?.awsAccessKeyId || "",
    awsSecretAccessKey: submitted.awsSecretAccessKey?.trim() || existing?.awsSecretAccessKey || "",
    awsSessionToken: submitted.awsSessionToken?.trim() || existing?.awsSessionToken,
    region: submitted.region?.trim() || "us-east-1",
    endpoint: submitted.endpoint?.trim() || "https://sellingpartnerapi-na.amazon.com",
  };
  return validateAmazonSpApiSettings(merged);
}
