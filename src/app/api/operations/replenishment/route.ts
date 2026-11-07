import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { parseReplenishmentInputs } from "@/lib/operations/replenishment";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { assertReplenishmentAccess } from "@/lib/operations/replenishment-access";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  const where = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  try {
    await auditAmazonDataRead(where, permission.user.id, "replenishment", permission.user.role);
    const allowed = process.env.DATABASE_URL ? await amazonDataAccess(where, permission.user.id) : { allSellers: false, sellerIds: [] };
    const sellerWhere = sellerAccessWhere(allowed);
    const sources = process.env.DATABASE_URL ? await prisma.amazonSyncDataSource.findMany({ where: { ...where, ...sellerWhere, seller: { status: "active" } }, select: { sellerAccountId: true, marketplaceId: true }, take: 201 }) : [];
    if (sources.length > 200) throw new SyncInputError("数据源超过安全范围。", 409);
    const sourcePairs = sources.map(({ sellerAccountId, marketplaceId }) => ({ sellerAccountId, marketplaceId }));
    const policies = sources.length ? await prisma.amazonReplenishmentPolicy.findMany({ where: { ...where, AND: [sellerWhere, { OR: sourcePairs }] }, orderBy: { updatedAt: "desc" }, take: 200 }) : [];
    const sellerAccounts = process.env.DATABASE_URL ? await prisma.sellerAccount.findMany({
      where: { ...where, ...(allowed.allSellers ? {} : { id: { in: allowed.sellerIds } }), status: "active" },
      select: { id: true, displayName: true, accountKey: true, marketplaceCode: true, marketplaceId: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    }) : [];
    const plans = policies.length ? await prisma.amazonReplenishmentPlan.findMany({ where: { ...where, AND: [sellerWhere, { OR: sourcePairs }], policyId: { in: policies.map((row) => row.id) } } }) : [];
    const edit = await requireApiPermission("operations", "edit", request);
    const reports = await requireApiPermission("sellfox", "view", request);
    return NextResponse.json({ rows: policies.filter((policy) => reports.ok || !parseReplenishmentInputs(policy.inputs).historicalSource).map((policy) => ({ ...policy, plan: plans.find((row) => row.policyId === policy.id) ?? null })), canEdit: edit.ok, canReadSellfox: reports.ok, sellerAccounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof SyncInputError ? "数据范围不可访问。" : "补货计划读取失败。" }, { status: error instanceof SyncInputError ? error.status : 500, headers: { "Cache-Control": "no-store" } }); }
}

export async function PATCH(request: Request) {
  const permission = await requireApiPermission("operations", "edit", request);
  if (!permission.ok) return permission.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    for (const field of ["sellerAccountId", "marketplaceId", "sellerSku"]) if (typeof body[field] !== "string" || !body[field].trim() || body[field].length > 200) throw new Error("必须填写店铺、站点和 SKU。");
    if (typeof body.enabled !== "boolean") throw new Error("enabled 必须为布尔值。");
    const inputs = parseReplenishmentInputs(body.inputs);
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const key = { ...scope, sellerAccountId: body.sellerAccountId as string, marketplaceId: body.marketplaceId as string, sellerSku: body.sellerSku as string };
    const data = { inputs: inputs as unknown as Prisma.InputJsonValue, enabled: body.enabled, updatedByUserId: permission.user.id };
    await prisma.$transaction(async tx => {
      await assertReplenishmentAccess(tx, scope, permission.user.id, key.sellerAccountId, key.marketplaceId, inputs.historicalSource?.storeId);
      const policy = await tx.amazonReplenishmentPolicy.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_sellerSku: key }, create: { id: randomUUID(), ...key, ...data }, update: { ...data, updatedAt: new Date() } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: permission.user.id, action: "amazon.replenishment.policy.saved", entityType: "AmazonReplenishmentPolicy", entityId: policy.id, metadata: { workspaceId: scope.workspaceId, sellerAccountId: key.sellerAccountId, marketplaceId: key.marketplaceId, enabled: body.enabled as boolean } } });
    });
    return NextResponse.json({ message: "参数已保存；worker 将在下轮检查重新生成建议（最多约 30 秒），之后每天计算。" });
  } catch (error) { return NextResponse.json({ error: error instanceof SyncInputError ? "数据范围不可访问。" : "补货参数保存失败，请检查参数。" }, { status: error instanceof SyncInputError ? error.status : 400, headers: { "Cache-Control": "no-store" } }); }
}
