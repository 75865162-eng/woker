import { NextResponse } from "next/server";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { listAmazonStores, renameAmazonStore } from "@/lib/amazon-sync/stores";
import { assertAmazonScopeAdmin } from "@/lib/amazon-sync/data-access";
import { prisma } from "@/lib/db/prisma";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function handle(request: Request, write: boolean) {
  try {
    const body = write ? await boundedJsonObject(request, 16000) : undefined;
    const permission = await requireApiPermission(write ? "settings" : "operations", write ? "edit" : "view", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    if (write) return json(await renameAmazonStore(scope, permission.user.id, body!));
    const sellerId = new URL(request.url).searchParams.get("auditSellerId");
    if (sellerId) {
      await assertAmazonScopeAdmin(scope, permission.user.id);
      if (!await prisma.sellerAccount.findFirst({ where: { ...scope, id: sellerId }, select: { id: true } })) throw new SyncInputError("数据范围不可访问。", 403);
      const logs = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId, metadata: { path: ["workspaceId"], equals: scope.workspaceId }, OR: [{ entityType: "SellerAccount", entityId: sellerId }, { metadata: { path: ["sellerAccountId"], equals: sellerId } }] }, select: { id: true, action: true, userId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
      return json({ logs });
    }
    return json({ stores: await listAmazonStores(scope, permission.user.id) });
  } catch (e) { return json({ error: e instanceof SyncInputError ? e.message : "店铺操作失败。" }, e instanceof SyncInputError ? e.status : 500); }
}
export const GET = (request: Request) => handle(request, false);
export const PATCH = (request: Request) => handle(request, true);
