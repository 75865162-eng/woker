import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { parseReplenishmentInputs } from "@/lib/operations/replenishment";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  const where = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  try {
    const policies = process.env.DATABASE_URL ? await prisma.amazonReplenishmentPolicy.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 }) : [];
    const plans = policies.length ? await prisma.amazonReplenishmentPlan.findMany({ where: { ...where, policyId: { in: policies.map((row) => row.id) } } }) : [];
    const edit = await requireApiPermission("operations", "edit", request);
    const reports = await requireApiPermission("sellfox", "view", request);
    return NextResponse.json({ rows: policies.filter((policy) => reports.ok || !parseReplenishmentInputs(policy.inputs).historicalSource).map((policy) => ({ ...policy, plan: plans.find((row) => row.policyId === policy.id) ?? null })), canEdit: edit.ok }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "补货计划读取失败。" }, { status: 500 }); }
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
    if (inputs.historicalSource) {
      const reports = await requireApiPermission("sellfox", "view", request);
      if (!reports.ok) return reports.response;
      const historyStore = await prisma.sellfoxStore.findFirst({ where: { ...scope, id: inputs.historicalSource.storeId } });
      if (!historyStore) throw new Error("历史报表店铺不属于当前组织/工作区。");
    }
    const store = await prisma.sellerAccount.findFirst({ where: { ...scope, id: body.sellerAccountId as string, status: "active" } });
    if (!store) return NextResponse.json({ error: "店铺不存在或不属于当前工作区。" }, { status: 400 });
    const key = { ...scope, sellerAccountId: store.id, marketplaceId: body.marketplaceId as string, sellerSku: body.sellerSku as string };
    const data = { inputs: inputs as unknown as Prisma.InputJsonValue, enabled: body.enabled, updatedByUserId: permission.user.id };
    await prisma.amazonReplenishmentPolicy.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_sellerSku: key }, create: { id: randomUUID(), ...key, ...data }, update: { ...data, updatedAt: new Date() } });
    return NextResponse.json({ message: "参数已保存；worker 将在下轮检查重新生成建议（最多约 30 秒），之后每天计算。" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "补货参数保存失败。" }, { status: 400 }); }
}
