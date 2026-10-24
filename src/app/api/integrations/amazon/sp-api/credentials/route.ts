import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { decryptAmazonSpApiCredentials, encryptAmazonSpApiCredentials, getAmazonSpApiSettings, mergeAmazonSpApiSettings, type AmazonSpApiSettings } from "@/lib/amazon/integration-secrets";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authorize(request: Request) {
  const result = await requireApiPermission("settings", "edit", request);
  return result.ok ? { user: result.user, scope: workspaceScopeFromRequest(request) } : { response: result.response };
}

export async function GET(request: Request) {
  try {
    const auth = await authorize(request);
    if (auth.response) return json({ error: "Forbidden." }, auth.response.status);
    const status = await getAmazonSpApiSettings({ organizationId: auth.user.organizationId, workspaceId: auth.scope.workspaceId });
    return json({ ...status, hasSavedCredentials: status.hasDatabaseCredentials });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Amazon API 配置读取失败。" }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authorize(request);
    if (auth.response) return json({ error: "Forbidden." }, auth.response.status);
    const scope = { organizationId: auth.user.organizationId, workspaceId: auth.scope.workspaceId };
    const body = await request.json() as Record<string, unknown>;
    const fieldNames = ["lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken", "region", "endpoint"] as const;
    const submitted: Partial<AmazonSpApiSettings> = {};
    for (const field of fieldNames) {
      const value = body[field];
      if (value !== undefined && typeof value !== "string") return json({ error: `字段 ${field} 格式无效。` }, 400);
      if (typeof value === "string" && value.length > 16_384) return json({ error: `字段 ${field} 超出长度限制。` }, 400);
      if (typeof value === "string") submitted[field] = value;
    }
    const existingRecord = await prisma.amazonIntegrationSecret.findUnique({ where: { organizationId_workspaceId: scope } });
    const otherScopeRecord = await prisma.amazonIntegrationSecret.findFirst({ where: { provider: "amazon_sp_api", NOT: scope }, select: { id: true } });
    if (otherScopeRecord) return json({ error: "当前 SP-API 凭证已绑定到其他组织/工作区；单组凭证不支持多个 scope 或 Seller 身份。" }, 409);
    const existing = existingRecord ? decryptAmazonSpApiCredentials(existingRecord.credentialsCiphertext, scope) : null;
    const settings = mergeAmazonSpApiSettings(existing, {
      ...submitted,
      region: submitted.region?.trim() || existingRecord?.awsRegion || undefined,
      endpoint: submitted.endpoint?.trim() || existingRecord?.endpoint || undefined,
    });
    const credentialsCiphertext = encryptAmazonSpApiCredentials(settings, scope);
    const changedFields = ["lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken", "region", "endpoint"]
      .filter((field) => !existingRecord || (field === "region" ? existingRecord.awsRegion !== settings.region : field === "endpoint" ? existingRecord.endpoint !== settings.endpoint : (existing as unknown as Record<string, unknown>)?.[field] !== settings[field as keyof AmazonSpApiSettings]));
    await prisma.$transaction(async (tx) => {
      if (!changedFields.length) return;
      await tx.amazonIntegrationSecret.upsert({
        where: { organizationId_workspaceId: scope },
        create: { ...scope, credentialsCiphertext, awsRegion: settings.region, endpoint: settings.endpoint, updatedByUserId: auth.user.id },
        update: { credentialsCiphertext, awsRegion: settings.region, endpoint: settings.endpoint, updatedByUserId: auth.user.id },
      });
      await tx.amazonIntegrationConnection.updateMany({
        where: { ...scope, provider: "amazon_sp_api" },
        data: { status: "NOT_CONFIGURED", statusMessage: "SP-API 凭证已更新，请重新验证连接。", enabledDomains: [], marketplaceParticipations: [], lastValidatedAt: null },
      });
      await tx.auditLog.create({ data: {
        organizationId: auth.user.organizationId,
        userId: auth.user.id,
        action: "amazon.sp_api_credentials.updated",
        entityType: "AmazonIntegrationSecret",
        entityId: scope.workspaceId,
        metadata: { workspaceId: scope.workspaceId, changedFields, credentialsEncrypted: true },
      } });
    });
    return json({ saved: true, configured: true, region: settings.region, endpoint: settings.endpoint });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Amazon API 配置保存失败。";
    const databaseCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const status = databaseCode === "P2002" ? 409
      : message.includes("服务器缺少有效") ? 503
      : message.includes("请填写") || message.includes("格式无效") || message.includes("长度限制") || message.includes("HTTPS 地址") || message.includes("AWS Region") ? 400
        : 500;
    return json({ error: message }, status);
  }
}
