import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { scoped } from '@/lib/wms/access';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';
import { assertPlanConvertible, parsePurchasePlanDraft, planProductWhere, purchasePlanHash, suggestPurchaseQty, type PurchasePlanDraft } from './plan-rules';

const planApprovalLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const maxSuggestRows = 200;

export type PlanSuggestionRow = {
  productRecordId: string;
  sku: string;
  name: string;
  availableQty: number;
  inboundQty: number;
  salesQty: number;
  suggestedQty: number;
  lastUnitPrice: string | null;
};

type Window = { salesWindowDays: number; coverageDays: number; safetyDays: number };

/**
 * 需求推算只读现有单据，不写任何东西：
 * - 可用量 = 公司仓余额 onHand - reserved（预占出去的货不能再算一次供给）
 * - 在途 = 未关联收货的已下单采购明细 + 已发出未签收的调拨数量
 * - 销量 = Amazon 订单明细在窗口内的下单数量（不含取消单）；Sellfox 快照仅作补充口径，不混算
 * 三个来源任一缺失都按 0 处理，宁可低估建议量，也不放大采购承诺。
 */
export async function suggestPlanRows(scope: WmsScope, input: Window & { productRecordIds?: string[]; limit?: number }): Promise<PlanSuggestionRow[]> {
  const limit = Math.min(Math.max(input.limit ?? maxSuggestRows, 1), maxSuggestRows);
  const windowStart = new Date(Date.now() - input.salesWindowDays * 24 * 60 * 60 * 1000);
  const [salesRows, onHandRows, inboundRows, transferRows] = await Promise.all([
    prisma.$queryRaw<Array<{ sku: string; qty: number }>>(Prisma.sql`
      SELECT i."sellerSku" AS sku, SUM(i."quantityOrdered")::int AS qty
      FROM "AmazonOrderItemRecord" i
      JOIN "AmazonOrderRecord" o ON o."id" = i."orderRecordId" AND o."organizationId" = i."organizationId" AND o."workspaceId" = i."workspaceId" AND o."sourceId" = i."sourceId"
      WHERE i."organizationId" = ${scope.organizationId} AND i."workspaceId" = ${scope.workspaceId}
        AND o."createdTime" >= ${windowStart}
        AND COALESCE(o."rawStatus", '') NOT IN ('Cancelled', 'Canceled')
        AND i."sellerSku" IS NOT NULL
      GROUP BY i."sellerSku"`),
    prisma.$queryRaw<Array<{ productRecordId: string; qty: number }>>(Prisma.sql`
      SELECT l."productRecordId" AS "productRecordId", SUM(b."onHand" - b."reserved")::int AS qty
      FROM "WmsStockBalance" b
      JOIN "WmsLot" l ON l."id" = b."lotId" AND l."organizationId" = b."organizationId" AND l."workspaceId" = b."workspaceId"
      WHERE b."organizationId" = ${scope.organizationId} AND b."workspaceId" = ${scope.workspaceId}
      GROUP BY l."productRecordId"`),
    prisma.$queryRaw<Array<{ productRecordId: string; qty: number }>>(Prisma.sql`
      SELECT pl."productRecordId" AS "productRecordId", SUM(pl."expectedQty")::int AS qty
      FROM "PurchaseOrderLine" pl
      JOIN "PurchaseOrder" po ON po."id" = pl."purchaseOrderId" AND po."organizationId" = pl."organizationId" AND po."workspaceId" = pl."workspaceId"
      WHERE pl."organizationId" = ${scope.organizationId} AND pl."workspaceId" = ${scope.workspaceId}
        AND po."status" IN ('ORDERED', 'RECEIVING')
        AND cardinality(po."wmsReceiptIds") = 0
      GROUP BY pl."productRecordId"`),
    prisma.$queryRaw<Array<{ productRecordId: string; qty: number }>>(Prisma.sql`
      SELECT l."productRecordId" AS "productRecordId", SUM(t."shippedQty" - t."receivedQty")::int AS qty
      FROM "WmsTransferOrderLine" t
      JOIN "WmsStockBalance" b ON b."id" = t."sourceBalanceId" AND b."organizationId" = t."organizationId" AND b."workspaceId" = t."workspaceId"
      JOIN "WmsLot" l ON l."id" = b."lotId" AND l."organizationId" = b."organizationId" AND l."workspaceId" = b."workspaceId"
      WHERE t."organizationId" = ${scope.organizationId} AND t."workspaceId" = ${scope.workspaceId}
        AND t."shippedQty" > t."receivedQty"
      GROUP BY l."productRecordId"`),
  ]);
  const toMap = (rows: Array<{ productRecordId: string; qty: number | null }>) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.productRecordId, Number(row.qty ?? 0));
    return map;
  };
  const onHand = toMap(onHandRows);
  const purchaseInbound = toMap(inboundRows);
  const transferInbound = toMap(transferRows);

  const scopedFilter = planProductWhere(scope, input.productRecordIds);
  const products = await prisma.productRecord.findMany({ where: scopedFilter, select: { id: true, sku: true, chineseName: true, englishName: true } });
  const bySku = new Map(products.map(product => [product.sku, product]));
  const salesByProduct = new Map<string, number>();
  for (const row of salesRows) {
    const product = bySku.get(row.sku);
    if (!product) continue;
    salesByProduct.set(product.id, (salesByProduct.get(product.id) ?? 0) + Number(row.qty ?? 0));
  }

  const candidateIds = new Set<string>([...salesByProduct.keys(), ...onHand.keys()]);
  if (input.productRecordIds?.length) for (const id of input.productRecordIds) candidateIds.add(id);
  const rows = products
    .filter(product => candidateIds.has(product.id))
    .map(product => {
      const availableQty = Math.max(onHand.get(product.id) ?? 0, 0);
      const inboundQty = Math.max((purchaseInbound.get(product.id) ?? 0) + (transferInbound.get(product.id) ?? 0), 0);
      const salesQty = salesByProduct.get(product.id) ?? 0;
      return {
        productRecordId: product.id,
        sku: product.sku,
        name: product.chineseName || product.englishName || product.sku,
        availableQty,
        inboundQty,
        salesQty,
        suggestedQty: suggestPurchaseQty({ availableQty, inboundQty, salesQty, ...input }),
        lastUnitPrice: null as string | null,
      };
    })
    .sort((left, right) => right.suggestedQty - left.suggestedQty || left.sku.localeCompare(right.sku))
    .slice(0, limit);

  if (!rows.length) return rows;
  const priceRows = await prisma.$queryRaw<Array<{ productRecordId: string; unitPrice: string }>>(Prisma.sql`
    SELECT DISTINCT ON (pl."productRecordId") pl."productRecordId" AS "productRecordId", pl."unitPrice"::text AS "unitPrice"
    FROM "PurchaseOrderLine" pl
    JOIN "PurchaseOrder" po ON po."id" = pl."purchaseOrderId" AND po."organizationId" = pl."organizationId" AND po."workspaceId" = pl."workspaceId"
    WHERE pl."organizationId" = ${scope.organizationId} AND pl."workspaceId" = ${scope.workspaceId}
      AND pl."productRecordId" IN (${Prisma.join(rows.map(row => row.productRecordId))})
      AND po."status" <> 'CANCELLED'
    ORDER BY pl."productRecordId", po."createdAt" DESC`);
  const priceByProduct = new Map(priceRows.map(row => [row.productRecordId, row.unitPrice]));
  return rows.map(row => ({ ...row, lastUnitPrice: priceByProduct.get(row.productRecordId) ?? null }));
}

async function assertPlanReferences(tx: Prisma.TransactionClient, scope: WmsScope, draft: PurchasePlanDraft) {
  if (draft.supplierId && !(await tx.supplier.findFirst({ where: { organizationId: scope.organizationId, id: draft.supplierId } }))) throw new WmsError('供应商不属于当前组织。', 400);
  const productIds = draft.lines.map(line => line.productRecordId);
  if ((await tx.productRecord.count({ where: { ...scoped(scope), id: { in: productIds } } })) !== productIds.length) throw new WmsError('部分商品不属于当前工作区。', 400);
}

function planLinesCreate(draft: PurchasePlanDraft) {
  return draft.lines.map(line => ({
    id: crypto.randomUUID(),
    productRecordId: line.productRecordId,
    onHandQty: line.onHandQty,
    inboundQty: line.inboundQty,
    salesQty: line.salesQty,
    suggestedQty: line.suggestedQty,
    plannedQty: line.plannedQty,
    unitPrice: new Prisma.Decimal(line.unitPrice),
    notes: line.notes,
  }));
}

export async function createPurchasePlan(scope: WmsScope, body: Record<string, unknown>) {
  const draft = parsePurchasePlanDraft(body);
  return prisma.$transaction(async tx => {
    await assertPlanReferences(tx, scope, draft);
    const { lines, ...header } = draft;
    const plan = await tx.purchasePlan.create({
      data: { id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...header, createdBy: scope.actorUserId, lines: { create: planLinesCreate(draft) } },
      include: { supplier: { select: { id: true, name: true } }, lines: { include: { product: { select: { sku: true, chineseName: true, englishName: true } } } } },
    });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.plan.create', entityType: 'PurchasePlan', entityId: plan.id, metadata: { workspaceId: scope.workspaceId, number: plan.number, lineCount: lines.length } } });
    return plan;
  });
}

export async function editPurchasePlanDraft(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '计划单 ID');
  const revision = requireRevision(body.revision);
  const draft = parsePurchasePlanDraft(body);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchasePlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const current = await tx.purchasePlan.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('采购计划不存在或不属于当前工作区。', 404);
    if (current.status !== 'DRAFT' || current.revision !== revision) throw new WmsError('仅可编辑当前版本的草稿计划，请刷新后重试。', 409);
    await assertPlanReferences(tx, scope, draft);
    const { lines, ...header } = draft;
    const plan = await tx.purchasePlan.update({
      where: { id },
      data: { ...header, revision: { increment: 1 }, lines: { deleteMany: {}, create: planLinesCreate(draft) } },
      include: { supplier: { select: { id: true, name: true } }, lines: { include: { product: { select: { sku: true, chineseName: true, englishName: true } } } } },
    });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.plan.edit-draft', entityType: 'PurchasePlan', entityId: id, metadata: { workspaceId: scope.workspaceId, previousRevision: revision, revision: plan.revision, lineCount: lines.length } } });
    return plan;
  });
}

/** 计划审批沿用采购单口径：申请人不能自批、审批过期失效、单据哈希变化即作废。 */
export async function submitPurchasePlanApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision']);
  const id = requireText(body.id, '计划单 ID');
  const revision = requireRevision(body.revision);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchasePlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const plan = await tx.purchasePlan.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!plan) throw new WmsError('采购计划不存在或不属于当前工作区。', 404);
    if (plan.status !== 'DRAFT' || plan.revision !== revision) throw new WmsError('仅当前版本的草稿计划可以提交审批。', 409);
    const updated = await tx.purchasePlan.update({ where: { id }, data: { status: 'PENDING_APPROVAL', revision: { increment: 1 } } });
    const approval = await tx.purchasePlanApproval.create({
      data: {
        id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, planId: id,
        expectedRevision: updated.revision,
        requestHash: purchasePlanHash({ ...plan, lines: plan.lines.map(line => ({ productRecordId: line.productRecordId, plannedQty: line.plannedQty, unitPrice: line.unitPrice.toString() })) }),
        requestedBy: scope.actorUserId, expiresAt: new Date(Date.now() + planApprovalLifetimeMs),
      },
    });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.plan.submit-approval', entityType: 'PurchasePlan', entityId: id, metadata: { workspaceId: scope.workspaceId, approvalId: approval.id, revision: updated.revision } } });
    return { plan: updated, approval };
  });
}

export async function decidePurchasePlanApproval(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['id', 'revision', 'decision', 'reason']);
  const id = requireText(body.id, '审批 ID');
  const revision = requireRevision(body.revision);
  if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') throw new WmsError('审批决定无效。', 400);
  const approved = body.decision === 'APPROVE';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!approved && !reason) throw new WmsError('拒绝时必须填写原因。', 400);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchasePlanApproval" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const approval = await tx.purchasePlanApproval.findFirst({ where: { ...scoped(scope), id } });
    if (!approval) throw new WmsError('计划审批不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "PurchasePlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${approval.planId} FOR UPDATE`;
    const plan = await tx.purchasePlan.findFirst({ where: { ...scoped(scope), id: approval.planId }, include: { lines: true } });
    if (!plan) throw new WmsError('采购计划不存在。', 404);
    if (approval.requestedBy === scope.actorUserId) throw new WmsError('计划审批禁止申请人自批。', 403);
    if (approval.status !== 'PENDING' || approval.revision !== revision || approval.expiresAt.getTime() <= Date.now() || plan.status !== 'PENDING_APPROVAL' || plan.revision !== approval.expectedRevision
      || purchasePlanHash({ ...plan, lines: plan.lines.map(line => ({ productRecordId: line.productRecordId, plannedQty: line.plannedQty, unitPrice: line.unitPrice.toString() })) }) !== approval.requestHash) {
      throw new WmsError('计划审批已过期、单据已变化或版本不匹配。', 409);
    }
    const decided = await tx.purchasePlanApproval.update({ where: { id }, data: { status: approved ? 'APPROVED' : 'REJECTED', approvedBy: scope.actorUserId, decisionReason: reason, revision: { increment: 1 } } });
    await tx.purchasePlan.update({ where: { id: plan.id }, data: { status: approved ? 'APPROVED' : 'DRAFT', revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `procurement.plan.approval.${approved ? 'approve' : 'reject'}`, entityType: 'PurchasePlan', entityId: plan.id, metadata: { workspaceId: scope.workspaceId, approvalId: id, reason } } });
    return decided;
  });
}

export async function cancelPurchasePlan(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision', 'reason']);
  const id = requireText(body.id, '计划单 ID');
  const revision = requireRevision(body.revision);
  const reason = requireText(body.reason, '作废原因', 500);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchasePlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const plan = await tx.purchasePlan.findFirst({ where: { ...scoped(scope), id } });
    if (!plan) throw new WmsError('采购计划不存在或不属于当前工作区。', 404);
    if (plan.revision !== revision) throw new WmsError('计划版本已变化，请刷新后核对。', 409);
    if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(plan.status)) throw new WmsError('已转采购单或已作废的计划不能再次作废。', 409);
    const updated = await tx.purchasePlan.update({ where: { id }, data: { status: 'CANCELLED', revision: { increment: 1 } } });
    await tx.purchasePlanApproval.updateMany({ where: { ...scoped(scope), planId: id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED', revision: { increment: 1 }, decisionReason: reason } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.plan.cancel', entityType: 'PurchasePlan', entityId: id, metadata: { workspaceId: scope.workspaceId, previousStatus: plan.status, previousRevision: revision, reason } } });
    return updated;
  });
}

/**
 * 转采购单只生成采购草稿（DRAFT），不直接下单：
 * 采购单仍需走原有审批 + 确认下单流程，计划不会绕过任何一道人工关卡。
 */
export async function convertPurchasePlanToOrder(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision', 'orderNumber', 'expectedAt']);
  const id = requireText(body.id, '计划单 ID');
  const revision = requireRevision(body.revision);
  const orderNumber = requireText(body.orderNumber, '采购单号', 80);
  const expectedAtText = typeof body.expectedAt === 'string' && body.expectedAt.trim() ? body.expectedAt.trim() : null;
  if (expectedAtText && !/^\d{4}-\d{2}-\d{2}$/.test(expectedAtText)) throw new WmsError('预计交期须为 YYYY-MM-DD。', 400);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PurchasePlan" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    const plan = await tx.purchasePlan.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!plan) throw new WmsError('采购计划不存在或不属于当前工作区。', 404);
    if (plan.revision !== revision) throw new WmsError('计划版本已变化，请刷新后核对。', 409);
    assertPlanConvertible(plan.status, plan.convertedOrderId);
    if (!plan.supplierId) throw new WmsError('转采购单前必须先指定供应商。', 400);
    if (!plan.lines.length) throw new WmsError('计划没有明细，不能转采购单。', 400);
    if (await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), number: orderNumber } })) throw new WmsError('采购单号已存在。', 409);
    const order = await tx.purchaseOrder.create({
      data: {
        id: crypto.randomUUID(), organizationId: scope.organizationId, workspaceId: scope.workspaceId, number: orderNumber,
        supplierId: plan.supplierId, notes: `由采购计划 ${plan.number} 转入`,
        expectedAt: expectedAtText ? new Date(`${expectedAtText}T00:00:00.000Z`) : null,
        createdBy: scope.actorUserId,
        lines: { create: plan.lines.map(line => ({ id: crypto.randomUUID(), productRecordId: line.productRecordId, expectedQty: line.plannedQty, unitPrice: line.unitPrice, notes: line.notes })) },
      },
    });
    const updated = await tx.purchasePlan.update({ where: { id }, data: { status: 'CONVERTED', convertedOrderId: order.id, revision: { increment: 1 } } });
    await tx.purchasePlanApproval.updateMany({ where: { ...scoped(scope), planId: id, status: 'APPROVED' }, data: { status: 'CONSUMED', revision: { increment: 1 } } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'procurement.plan.convert', entityType: 'PurchasePlan', entityId: id, metadata: { workspaceId: scope.workspaceId, orderId: order.id, orderNumber, lineCount: plan.lines.length } } });
    return { plan: updated, order };
  });
}
