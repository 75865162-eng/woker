import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

import { cancelPurchaseOrder, confirmPurchasePayment, decidePurchaseOrderApproval, editPurchaseDraft, placeApprovedPurchaseOrder, submitPurchaseOrderApproval, submitPurchasePaymentApproval } from "@/lib/procurement/order-service";
import { cancelPurchaseRefundApproval, confirmPurchaseRefund, submitPurchaseRefundApproval } from "@/lib/procurement/refund-service";
import { parsePurchaseDraft } from "@/lib/procurement/order-input";
import { createPurchaseReceipt } from "@/lib/procurement/receipt-service";
import { parsePurchaseQuery, queryPurchaseOrders, queryPurchasePriceReferences, queryPurchaseSupplierOptions, parseSupplierQuery, querySuppliers } from "@/lib/procurement/query-service";
import { WmsError } from "@/lib/wms/contracts";
import { WmsInputError } from "@/lib/wms/rules";

export const runtime = "nodejs";
class ProcurementInputError extends Error {}
const errorResponse = (error: unknown) => {
  if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: error.code === "P2002" ? "编号或供应商名称已存在，请检查后重试。" : "采购记录冲突，请刷新后重试。" }, { status: 409 });
  if (error instanceof ProcurementInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[operations.procurement]", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "采购服务暂不可用。" }, { status: 500 });
};
async function scopeFor(request: Request, action: "view" | "create" | "edit" | "approve") {
  const auth = await requireApiPermission("operations", action, request);
  if (!auth.ok) return { response: auth.response } as const;
  return { user: auth.user, scope: { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId } } as const;
}

export async function GET(request: Request) {
  const auth = await scopeFor(request, "view");
  if ("response" in auth) return auth.response;
  const { organizationId, workspaceId } = auth.scope;
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "suppliers") {
      return NextResponse.json(await querySuppliers(organizationId, parseSupplierQuery(params)), { headers: { "Cache-Control": "no-store" } });
    }
    if (params.get("view") === "price-history") {
      const prices = await queryPurchasePriceReferences({ ...auth.scope, actorUserId: auth.user.id }, params);
      return NextResponse.json({ prices: prices.map(row => ({ ...row, orderedAt: row.orderedAt.toISOString() })) }, { headers: { "Cache-Control": "no-store" } });
    }
    const query = parsePurchaseQuery(params);
    const [suppliers, products, result] = await Promise.all([
      queryPurchaseSupplierOptions(organizationId, query.supplierId),
      prisma.productSummaryRecord.findMany({ where: { organizationId, workspaceId }, orderBy: { sku: "asc" }, take: 500, select: { productRecordId: true, sku: true, chineseName: true, englishName: true } }),
      queryPurchaseOrders({ ...auth.scope, actorUserId: auth.user.id }, query),
    ]);
    return NextResponse.json({ suppliers, products, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await scopeFor(request, "create");
  if ("response" in auth) return auth.response;
  const { organizationId, workspaceId } = auth.scope;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "supplier") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
      if (!name) return NextResponse.json({ error: "供应商名称必填。" }, { status: 400 });
      const supplier = await prisma.$transaction(async tx => {
        const saved = await tx.supplier.create({ data: { organizationId, name, normalizedName: name.normalize("NFKC").trim().toLocaleLowerCase(), contactName: String(body.contactName ?? "").trim().slice(0, 120), phone: String(body.phone ?? "").trim().slice(0, 80), email: String(body.email ?? "").trim().slice(0, 160), address: String(body.address ?? "").trim().slice(0, 500), notes: String(body.notes ?? "").trim().slice(0, 1000) } });
        await tx.auditLog.create({ data: { organizationId, userId: auth.user.id, action: "procurement.supplier.create", entityType: "Supplier", entityId: saved.id, metadata: { workspaceId } } });
        return saved;
      });
      return NextResponse.json({ supplier }, { status: 201 });
    }
    if (body.action !== "order") return NextResponse.json({ error: "未知采购操作。" }, { status: 400 });
    const { lines: draftLines, ...draft } = parsePurchaseDraft(body);
    const { number, supplierId } = draft;
    const lines = draftLines.map(line => ({ ...line, id: crypto.randomUUID(), unitPrice: new Prisma.Decimal(line.unitPrice) }));
    const order = await prisma.$transaction(async tx => {
      if (!await tx.supplier.findFirst({ where: { organizationId, id: supplierId } })) throw new ProcurementInputError("供应商不属于当前组织。");
      const validProducts = await tx.productRecord.count({ where: { organizationId, workspaceId, id: { in: lines.map(line => line.productRecordId) } } });
      if (validProducts !== lines.length) throw new ProcurementInputError("部分商品不属于当前工作区。");
      const saved = await tx.purchaseOrder.create({ data: { id: crypto.randomUUID(), organizationId, workspaceId, ...draft, createdBy: auth.user.id, lines: { create: lines } }, include: { supplier: { select: { id: true, name: true } }, lines: { include: { product: { select: { sku: true, chineseName: true, englishName: true } } } } } });
      await tx.auditLog.create({ data: { organizationId, userId: auth.user.id, action: "procurement.order.create", entityType: "PurchaseOrder", entityId: saved.id, metadata: { workspaceId, number, lineCount: lines.length } } });
      return saved;
    });
    return NextResponse.json({ order: { ...order, lines: order.lines.map(line => ({ ...line, unitPrice: line.unitPrice.toString() })) } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.clone().json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "请求内容无效。" }, { status: 400 }); }
  const permission = body.decision === "APPROVE" || body.decision === "REJECT" ? "approve" : ["submit-payment-approval", "confirm-payment", "submit-refund-approval", "confirm-refund", "cancel-refund-approval"].includes(String(body.action)) ? "create" : "edit";
  const auth = await scopeFor(request, permission);
  if ("response" in auth) return auth.response;
  try {
    if (body.decision === "APPROVE" || body.decision === "REJECT") {
      const approval = await decidePurchaseOrderApproval({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json({ approval }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "supplier") {
      const supplierId = typeof body.id === "string" ? body.id : "";
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
      if (!supplierId || !name) throw new ProcurementInputError("供应商名称必填。");
      const supplier = await prisma.$transaction(async tx => {
        if (!await tx.supplier.findFirst({ where: { organizationId: auth.scope.organizationId, id: supplierId } })) throw new ProcurementInputError("供应商不属于当前组织。");
        const updated = await tx.supplier.update({ where: { id: supplierId }, data: { name, normalizedName: name.normalize("NFKC").trim().toLocaleLowerCase(), contactName: String(body.contactName ?? "").trim().slice(0, 120), phone: String(body.phone ?? "").trim().slice(0, 80), email: String(body.email ?? "").trim().slice(0, 160), address: String(body.address ?? "").trim().slice(0, 500), notes: String(body.notes ?? "").trim().slice(0, 1000) } });
        await tx.auditLog.create({ data: { organizationId: auth.scope.organizationId, userId: auth.user.id, action: "procurement.supplier.edit", entityType: "Supplier", entityId: supplierId, metadata: { workspaceId: auth.scope.workspaceId } } });
        return updated;
      });
      return NextResponse.json({ supplier });
    }
    if (body.action === "cancel-order") {
      const order = await cancelPurchaseOrder({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "edit-order") {
      const order = await editPurchaseDraft({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "submit-approval") {
      const result = await submitPurchaseOrderApproval({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "place-order") {
      const order = await placeApprovedPurchaseOrder({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "submit-payment-approval") {
      const result = await submitPurchasePaymentApproval({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json(result, { status: result.reused ? 200 : 201, headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "confirm-payment") {
      const result = await confirmPurchasePayment({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json(result, { status: result.reused ? 200 : 201, headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "submit-refund-approval") {
      const result = await submitPurchaseRefundApproval({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json(result, { status: result.reused ? 200 : 201, headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "cancel-refund-approval") {
      const result = await cancelPurchaseRefundApproval({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "confirm-refund") {
      const result = await confirmPurchaseRefund({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json(result, { status: result.reused ? 200 : 201, headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "create-receipt") {
      const createAuth = await requireApiPermission("operations", "create", request);
      if (!createAuth.ok) return createAuth.response;
      const result = await createPurchaseReceipt({ ...auth.scope, actorUserId: auth.user.id }, body);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    const id = typeof body.id === "string" ? body.id : "";
    const action = body.action;
    const order = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${auth.scope.organizationId} AND "workspaceId"=${auth.scope.workspaceId} AND id=${id} FOR UPDATE`;
      const current = await tx.purchaseOrder.findFirst({ where: { id, organizationId: auth.scope.organizationId, workspaceId: auth.scope.workspaceId }, include: { lines: true } });
      if (!current) throw new ProcurementInputError("采购单不存在或不属于当前工作区。");
      if (action === "link-receipt" && typeof body.receiptId === "string") {
        await tx.$queryRaw`SELECT id FROM "WmsReceipt" WHERE "organizationId"=${auth.scope.organizationId} AND "workspaceId"=${auth.scope.workspaceId} AND id=${body.receiptId} FOR UPDATE`;
        const receipt = await tx.wmsReceipt.findFirst({
          where: { id: body.receiptId, organizationId: auth.scope.organizationId, workspaceId: auth.scope.workspaceId },
          include: { lines: { include: { lot: { select: { productRecordId: true } } } } },
        });
        if (!receipt || receipt.sourceReference !== current.number || !["DRAFT", "RECEIVED", "INSPECTED", "PUTAWAY"].includes(receipt.status)) throw new ProcurementInputError("WMS 收货单不属于此采购单或来源编号不匹配。");
        const expected = new Map(current.lines.map(line => [line.productRecordId, line.expectedQty]));
        const received = new Map<string, number>();
        for (const line of receipt.lines) received.set(line.lot.productRecordId, (received.get(line.lot.productRecordId) ?? 0) + line.expectedQty);
        if (expected.size !== received.size || [...expected].some(([productId, quantity]) => received.get(productId) !== quantity)) throw new ProcurementInputError("WMS 收货商品或计划数量与采购单不一致。");
        if (current.wmsReceiptIds.includes(receipt.id)) return current;
      }
      if (body.revision !== current.revision) throw new ProcurementInputError("采购单已被其他操作更新，请刷新后重试。");
      let changed = 0;
      if (action === "link-receipt" && current.status === "ORDERED" && typeof body.receiptId === "string" && body.receiptId.length < 100) {
        changed = (await tx.purchaseOrder.updateMany({ where: { id, organizationId: auth.scope.organizationId, workspaceId: auth.scope.workspaceId, revision: current.revision, status: "ORDERED" }, data: { status: "RECEIVING", wmsReceiptIds: { push: body.receiptId }, revision: { increment: 1 } } })).count;
      }
      if (!changed) throw new ProcurementInputError("当前采购单状态不允许此操作，或版本已变化。");
      const updated = await tx.purchaseOrder.findFirstOrThrow({ where: { id, organizationId: auth.scope.organizationId, workspaceId: auth.scope.workspaceId } });
      await tx.auditLog.create({ data: { organizationId: auth.scope.organizationId, userId: auth.user.id, action: `procurement.order.${String(action)}`, entityType: "PurchaseOrder", entityId: id, metadata: { workspaceId: auth.scope.workspaceId, receiptId: body.receiptId ?? null } } });
      return updated;
    });
    return NextResponse.json({ order });
  } catch (error) { return errorResponse(error); }
}
