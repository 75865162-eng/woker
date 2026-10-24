import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSpApiSettings } from "@/lib/amazon/integration-secrets";
import { resolveSellerBindingSource, validateSellerBindingRows, type AmazonSellerBinding } from "@/lib/amazon/seller-bindings";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authorized(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  return permission.ok ? { user: permission.user, scope: workspaceScopeFromRequest(request) } : { response: permission.response };
}

export async function GET(request: Request) {
  try {
    const auth = await authorized(request);
    if (auth.response) return json({ error: "Forbidden." }, auth.response.status);
    const { user, scope } = auth;
    const where = { organizationId: user.organizationId, workspaceId: scope.workspaceId };
    const [databaseRows, sellerAccounts, connection] = await Promise.all([
      prisma.amazonSellerBinding.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.sellerAccount.findMany({ where: { ...where, status: "active" }, orderBy: [{ displayName: "asc" }, { accountKey: "asc" }], select: { id: true, displayName: true, accountKey: true, marketplaceCode: true, marketplaceId: true } }),
      prisma.amazonIntegrationConnection.findUnique({ where: { organizationId_workspaceId_provider: { ...where, provider: "amazon_sp_api" } } }),
    ]);
    const runtimeConfiguration = await getAmazonSpApiSettings({ organizationId: user.organizationId, workspaceId: scope.workspaceId });
    const normalizedRows: AmazonSellerBinding[] = databaseRows.map((row) => ({ ...row, authorizedResources: row.authorizedResources.filter((value): value is "inventory" | "catalog" => value === "inventory" || value === "catalog") }));
    const { usingEnvironmentFallback, bindings } = resolveSellerBindingSource({ databaseRows: normalizedRows, environmentValue: process.env.AMAZON_SP_API_SELLER_BINDINGS, organizationId: user.organizationId, workspaceId: scope.workspaceId });
    const boundAccounts = await prisma.sellerAccount.findMany({ where: { ...where, status: "active", id: { in: bindings.map((row) => row.sellerAccountId) } }, select: { id: true } });
    const activeIds = new Set(boundAccounts.map((account) => account.id));
    return json({
      scope: { organizationId: user.organizationId, workspaceId: scope.workspaceId },
      runtimeConfiguration,
      connection: connection ? { status: connection.status, statusMessage: connection.statusMessage, lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null } : null,
      usingEnvironmentFallback,
      bindings: validateSellerBindingRows(bindings).map(({ sellerAccountId, marketplaceId, amazonSellerId, authorizedResources }) => ({ sellerAccountId, marketplaceId, amazonSellerId, authorizedResources, active: activeIds.has(sellerAccountId) })),
      sellerAccounts,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Amazon 绑定读取失败。" }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authorized(request);
    if (auth.response) return json({ error: "Forbidden." }, auth.response.status);
    const { user, scope } = auth;
    const body = await request.json() as { bindings?: unknown };
    if (!Array.isArray(body.bindings)) return json({ error: "请提交 bindings 数组。" }, 400);
    const rows: AmazonSellerBinding[] = body.bindings.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Amazon 店铺绑定格式无效。");
      const row = value as Record<string, unknown>;
      const requiredStrings = ["sellerAccountId", "marketplaceId", "amazonSellerId"];
      for (const key of requiredStrings) if (typeof row[key] !== "string" || !row[key].trim() || row[key].length > 200) throw new Error("Amazon 店铺绑定身份字段无效。");
      if (!Array.isArray(row.authorizedResources) || row.authorizedResources.length === 0 || row.authorizedResources.some((item) => item !== "inventory" && item !== "catalog")) throw new Error("请至少选择一个已获授权的同步域。");
      return {
        organizationId: user.organizationId,
        workspaceId: scope.workspaceId,
        sellerAccountId: (row.sellerAccountId as string).trim(),
        marketplaceId: (row.marketplaceId as string).trim(),
        amazonSellerId: (row.amazonSellerId as string).trim(),
        authorizedResources: [...new Set(row.authorizedResources as ("inventory" | "catalog")[])],
      };
    });
    validateSellerBindingRows(rows);
    const activeAccounts = rows.length ? await prisma.sellerAccount.findMany({
      where: { organizationId: user.organizationId, workspaceId: scope.workspaceId, status: "active", id: { in: rows.map((row) => row.sellerAccountId) } },
      select: { id: true },
    }) : [];
    if (activeAccounts.length !== new Set(rows.map((row) => row.sellerAccountId)).size) return json({ error: "绑定店铺必须属于当前组织和工作区，且状态为 active。" }, 400);

    const where = { organizationId: user.organizationId, workspaceId: scope.workspaceId };
    const changedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const before = await tx.amazonSellerBinding.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, amazonSellerId: true, authorizedResources: true } });
      await tx.amazonSellerBinding.deleteMany({ where });
      if (rows.length) await tx.amazonSellerBinding.createMany({ data: rows });
      const beforeSignature = JSON.stringify(before.map((row) => [row.sellerAccountId, row.marketplaceId, row.amazonSellerId, [...row.authorizedResources].sort()]).sort());
      const afterSignature = JSON.stringify(rows.map((row) => [row.sellerAccountId, row.marketplaceId, row.amazonSellerId, [...row.authorizedResources].sort()]).sort());
      if (beforeSignature !== afterSignature) {
        await tx.auditLog.create({ data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: "amazon.seller_bindings.updated",
          entityType: "AmazonSellerBinding",
          entityId: scope.workspaceId,
          metadata: { workspaceId: scope.workspaceId, beforeCount: before.length, afterCount: rows.length, changedAt: changedAt.toISOString(), changed: true },
        } });
      }
    });
    return json({ saved: true, bindingCount: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Amazon 店铺绑定保存失败。";
    return json({ error: message }, message.includes("Amazon 店铺绑定") || message.includes("Seller ID") || message.includes("Marketplace") || message.includes("同步域") ? 400 : 500);
  }
}
