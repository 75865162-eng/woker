import { prisma } from "@/lib/db/prisma";
import { authorizeWms, auditWms, scoped } from "@/lib/wms/access";
import { createWmsResourceInTransaction } from "@/lib/wms/catalog-service";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireRevision, requireText, strictKeys, WmsInputError } from "@/lib/wms/rules";
import { summarizePurchaseReceipts, type PurchaseReceiptSummary } from "./receipt-summary";
import { parsePurchaseReceiptLines } from "./receipt-input";
import { remainingPurchaseQuantities } from "./receipt-allocation";

type AllocationOrder = { id: string; number: string; status: string; wmsReceiptIds: string[]; lines: Array<{ productRecordId: string; expectedQty: number }> };

/** WMS-derived quantities are only exposed after current warehouse read authorization. */
export async function purchaseReceiptAllocations(scope: WmsScope, orders: AllocationOrder[]) {
  const unknown = new Map(orders.map(order => [order.id, { receiptSummary: null as PurchaseReceiptSummary | null, remainingQty: null as number | null, remainingLines: null as Array<{ productRecordId: string; expectedQty: number }> | null, canCreateReceipt: false, canCancel: false }]));
  try {
    return await prisma.$transaction(async tx => {
      await authorizeWms(tx, scope, "view");
      const receipts = await tx.wmsReceipt.findMany({
        where: { ...scoped(scope), id: { in: orders.flatMap(order => order.wmsReceiptIds) } },
        include: { lines: { include: { lot: { select: { productRecordId: true } } } } },
      });
      const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
      for (const order of orders) {
        if (new Set(order.wmsReceiptIds).size !== order.wmsReceiptIds.length) continue;
        const linked = order.wmsReceiptIds.map(id => byId.get(id));
        if (linked.some(receipt => !receipt || receipt.sourceReference !== order.number)) continue;
        const remaining = remainingPurchaseQuantities(order.lines, linked.flatMap(receipt => receipt ? [{ status: receipt.status, lines: receipt.lines.map(line => ({ ...line, productRecordId: line.lot.productRecordId })) }] : []));
        if (!remaining || [...remaining.values()].some(quantity => quantity < 0)) continue;
        const remainingQty = [...remaining.values()].reduce((sum, quantity) => sum + quantity, 0);
        unknown.set(order.id, { receiptSummary: summarizePurchaseReceipts(order.lines, linked.flatMap(receipt => receipt ? [{ status: receipt.status, lines: receipt.lines.map(line => ({ ...line, productRecordId: line.lot.productRecordId })) }] : [])), remainingQty, remainingLines: [...remaining].map(([productRecordId, expectedQty]) => ({ productRecordId, expectedQty })), canCreateReceipt: ["ORDERED", "RECEIVING"].includes(order.status) && remainingQty > 0, canCancel: (["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED"].includes(order.status) && order.wmsReceiptIds.length === 0) || (order.status === "RECEIVING" && linked.length > 0 && linked.every(receipt => receipt?.status === "CANCELLED")) });
      }
      return unknown;
    });
  } catch (error) {
    if (error instanceof WmsInputError && error.status === 403) return unknown;
    throw error;
  }
}

/** Allocate outstanding order quantities into one receipt draft atomically. */
export async function createPurchaseReceipt(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ["action", "id", "revision", "receivingLocationId", "lines"]);
  const id = requireText(body.id, "采购单 ID");
  const revision = requireRevision(body.revision);
  const receivingLocationId = requireText(body.receivingLocationId, "收货库位");
  const requested = parsePurchaseReceiptLines(body.lines);
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "create");
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!order) throw new WmsError("采购单不存在或不属于当前工作区。", 404);
    const number = `PO-RCV-${order.id}-${revision}`;
    if (order.revision !== revision) {
      const receipt = await tx.wmsReceipt.findFirst({ where: { ...scoped(scope), id: { in: order.wmsReceiptIds }, number, sourceReference: order.number, receivingLocationId }, include: { lines: { include: { lot: { select: { productRecordId: true } } } } } });
      if (receipt && revision < order.revision) {
        const evidence = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "wms.procurement.receipt.create", entityId: receipt.id }, select: { metadata: true } });
        const detail = evidence?.metadata && typeof evidence.metadata === "object" && !Array.isArray(evidence.metadata) ? evidence.metadata.detail : undefined;
        const original = detail && typeof detail === "object" && !Array.isArray(detail) ? detail.requestLines : undefined;
        if (!requested && Array.isArray(original)) throw new WmsError("重试须保留原分批收货明细，请刷新后核对。", 409);
        if (requested && (receipt.lines.length !== requested.length || receipt.lines.some(line => !requested.some(item => item.productRecordId === line.lot.productRecordId && item.expectedQty === line.expectedQty)))) throw new WmsError("重试收货数量与原请求不一致，请刷新后核对。", 409);
        return { receipt, reused: true };
      }
      throw new WmsError("采购单状态或版本已变化，请刷新后重试。", 409);
    }
    if (!["ORDERED", "RECEIVING"].includes(order.status)) throw new WmsError("采购单状态或版本已变化，请刷新后重试。", 409);
    const previous = order.wmsReceiptIds.length ? await tx.wmsReceipt.findMany({
      where: { ...scoped(scope), id: { in: order.wmsReceiptIds }, sourceReference: order.number },
      include: { lines: { include: { lot: { select: { productRecordId: true } } } } },
    }) : [];
    if (previous.length !== order.wmsReceiptIds.length) throw new WmsError("部分关联收货单不可读取，请刷新采购单后重试。", 409);
    const outstanding = remainingPurchaseQuantities(order.lines, previous.map(receipt => ({ status: receipt.status, lines: receipt.lines.map(line => ({ ...line, productRecordId: line.lot.productRecordId })) })));
    if (!outstanding || [...outstanding.values()].some(quantity => quantity < 0)) throw new WmsError("关联收货数量或状态异常，请核对收货单。", 409);
    if (requested?.some(line => !outstanding.has(line.productRecordId) || line.expectedQty > outstanding.get(line.productRecordId)!)) throw new WmsError("本次计划收货数量超过商品可建收货数量，或商品不属于此采购单。", 409);
    const quantities = requested ? new Map(requested.map(line => [line.productRecordId, line.expectedQty])) : outstanding;
    const remaining = order.lines.filter(line => (quantities.get(line.productRecordId) ?? 0) > 0);
    if (!remaining.length) throw new WmsError("暂无可创建收货单的数量，请先处理已关联的收货单。", 409);
    const lines: Array<{ lotId: string; expectedQty: number }> = [];
    for (const line of remaining) {
      const lot = await createWmsResourceInTransaction(tx, scope, "lots", { productRecordId: line.productRecordId, lotCode: `PO-${order.id}-${line.id}-${crypto.randomUUID().slice(0, 8)}` });
      lines.push({ lotId: lot.id, expectedQty: quantities.get(line.productRecordId)! });
    }
    const receipt = await createWmsResourceInTransaction(tx, scope, "receipts", { receivingLocationId, number, sourceReference: order.number, lines });
    const changed = await tx.purchaseOrder.updateMany({ where: { ...scoped(scope), id, revision, status: order.status }, data: { status: "RECEIVING", wmsReceiptIds: { push: receipt.id }, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new WmsError("采购单版本已变化，请刷新后重试。", 409);
    await auditWms(tx, scope, "procurement.receipt.create", receipt.id, { purchaseOrderId: id, requestLines: requested ?? null });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: "procurement.order.link-receipt", entityType: "PurchaseOrder", entityId: id, metadata: { workspaceId: scope.workspaceId, receiptId: receipt.id } } });
    return { receipt, reused: false };
  });
}
