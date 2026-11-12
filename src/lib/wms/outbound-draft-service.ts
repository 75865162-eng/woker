import { prisma } from "@/lib/db/prisma";
import { authorizeWms, auditWms, scoped } from "./access";
import { WmsError, type WmsScope } from "./contracts";
import { lockAggregate, type Tx } from "./repository";
import { requirePositiveQuantity, requireRevision, requireText, strictKeys, wmsMaxReceiptLines } from "./rules";

function parseLines(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > wmsMaxReceiptLines) throw new WmsError("出库明细须为 1-100 行。", 400);
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsError("出库明细无效。", 400);
    const line = raw as Record<string, unknown>;
    strictKeys(line, ["productRecordId", "requestedQty"]);
    const productRecordId = requireText(line.productRecordId, "商品 ID");
    if (seen.has(productRecordId)) throw new WmsError("同一商品请合并为一行需求。", 422);
    seen.add(productRecordId);
    return { productRecordId, requestedQty: requirePositiveQuantity(line.requestedQty) };
  });
}

async function lockOutbound(scope: WmsScope, tx: Tx, id: string) {
  if (!await tx.wmsOutbound.findFirst({ where: { ...scoped(scope), id }, select: { id: true } })) throw new WmsError("出库需求不存在。", 404);
  await lockAggregate(tx, scope, id, "outbound");
  const lines = await tx.wmsOutboundLine.findMany({ where: { ...scoped(scope), outboundId: id }, select: { id: true }, orderBy: { id: "asc" } });
  for (const line of lines) await lockAggregate(tx, scope, line.id, "outboundLine");
}

export async function updateOutboundDraft(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ["action", "id", "revision", "customer", "deliveryAddress", "carrier", "trackingNumber", "remark", "lines"]);
  if (body.action !== "EDIT") throw new WmsError("出库需求操作无效。", 400);
  const id = requireText(body.id, "出库需求 ID");
  const revision = requireRevision(body.revision);
  const lines = parseLines(body.lines);
  const metadata = {
    customer: body.customer ? requireText(body.customer, "收货方", 200) : null,
    deliveryAddress: body.deliveryAddress ? requireText(body.deliveryAddress, "收货地址", 500) : null,
    carrier: body.carrier ? requireText(body.carrier, "承运商", 120) : null,
    trackingNumber: body.trackingNumber ? requireText(body.trackingNumber, "物流单号", 120) : null,
    remark: body.remark ? requireText(body.remark, "备注", 1000) : null,
  };
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "edit");
    await lockOutbound(scope, tx, id);
    const outbound = await tx.wmsOutbound.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!outbound) throw new WmsError("出库需求不存在。", 404);
    if (outbound.createdBy !== scope.actorUserId) throw new WmsError("仅创建人可编辑出库需求草稿。", 403);
    if (outbound.status !== "DRAFT" || outbound.revision !== revision) throw new WmsError("出库需求已变更或不再是草稿，请刷新。", 409);
    for (const line of lines) if (!await tx.productRecord.findFirst({ where: { ...scoped(scope), id: line.productRecordId }, select: { id: true } })) throw new WmsError("商品不属于当前工作区。", 422);

    const byProduct = new Map(outbound.lines.map(line => [line.productRecordId, line]));
    const requestedProducts = new Set(lines.map(line => line.productRecordId));
    const removedIds = outbound.lines.filter(line => !requestedProducts.has(line.productRecordId)).map(line => line.id);
    if (removedIds.length && await tx.wmsReservation.findFirst({ where: { ...scoped(scope), outboundLineId: { in: removedIds } }, select: { id: true } })) throw new WmsError("已有预占关联此需求明细，不能移除。", 409);
    if (removedIds.length && await tx.wmsOutboundConsumable.findFirst({where:{...scoped(scope),outboundLineId:{in:removedIds}},select:{id:true}})) throw new WmsError("需求明细已配置耗材，不能移除；可取消草稿后重建。",409);
    const changedLines = lines.filter(line => byProduct.get(line.productRecordId)?.requestedQty !== line.requestedQty);
    const metadataChanged = Object.keys(metadata).some(key => outbound[key as keyof typeof metadata] !== metadata[key as keyof typeof metadata]);
    if (!changedLines.length && !removedIds.length && !metadataChanged) return outbound;

    const updated = await tx.wmsOutbound.updateMany({ where: { ...scoped(scope), id, status: "DRAFT", revision }, data: { ...metadata, revision: { increment: 1 } } });
    if (updated.count !== 1) throw new WmsError("出库需求已变更，请刷新。", 409);
    if (removedIds.length) await tx.wmsOutboundLine.deleteMany({ where: { ...scoped(scope), id: { in: removedIds }, outboundId: id } });
    for (const line of lines) {
      const existing = byProduct.get(line.productRecordId);
      if (existing && existing.requestedQty !== line.requestedQty) await tx.wmsOutboundLine.update({ where: { id: existing.id }, data: { requestedQty: line.requestedQty, revision: { increment: 1 } } });
      else if (!existing) await tx.wmsOutboundLine.create({ data: { ...scoped(scope), id: crypto.randomUUID(), warehouseId: outbound.warehouseId, outboundId: id, ...line } });
    }
    await auditWms(tx, scope, "outbounds.edit-draft", id, { revision, lineCount: lines.length });
    return tx.wmsOutbound.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  });
}

export async function cancelOutbound(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ["action", "id", "revision"]);
  if (body.action !== "CANCEL") throw new WmsError("出库需求操作无效。", 400);
  const id = requireText(body.id, "出库需求 ID");
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "edit");
    await lockOutbound(scope, tx, id);
    const outbound = await tx.wmsOutbound.findFirst({ where: { ...scoped(scope), id }, include: { lines: { select: { id: true } } } });
    if (!outbound) throw new WmsError("出库需求不存在。", 404);
    if (outbound.createdBy !== scope.actorUserId) throw new WmsError("仅创建人可取消出库需求。", 403);
    if (outbound.status === "COMPLETED" || outbound.status === "CANCELLED" || outbound.revision !== revision) throw new WmsError("出库需求已变更或已结束。", 409);
    const lineIds = outbound.lines.map(line => line.id);
    const allocations = lineIds.length ? await tx.wmsReservation.aggregate({ where: { ...scoped(scope), outboundLineId: { in: lineIds } }, _sum: { requestedQty: true, releasedQty: true, dispatchedQty: true } }) : null;
    const activeQty = (allocations?._sum.requestedQty ?? 0) - (allocations?._sum.releasedQty ?? 0) - (allocations?._sum.dispatchedQty ?? 0);
    if (activeQty > 0) throw new WmsError("请先释放此需求的未完成预占，再取消需求。", 409);
    const updated = await tx.wmsOutbound.updateMany({ where: { ...scoped(scope), id, revision }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    if (updated.count !== 1) throw new WmsError("出库需求已变更，请刷新。", 409);
    await auditWms(tx, scope, "outbounds.cancel", id, { revision });
    return tx.wmsOutbound.findUniqueOrThrow({ where: { id } });
  });
}
