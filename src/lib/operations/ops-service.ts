import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditWms, authorizeWms, json, scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import {
  parseCarrierDraft, parseUnsalablePolicy, parseWarehouseDraft,
  unsalableFingerprint, unsalableRows, type UnsalableInput, type UnsalablePolicy,
} from './ops-rules';

type OpKind = 'carrier' | 'warehouse';

export async function queryOps(scope: WmsScope, kind: string) {
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, 'view');
    const where = scoped(scope);
    if (kind === 'carriers') return { items: await tx.carrier.findMany({ where, orderBy: { code: 'asc' }, take: 200 }) };
    if (kind === 'warehouses') return { items: await tx.thirdPartyWarehouse.findMany({ where, orderBy: { code: 'asc' }, take: 200 }) };
    if (kind === 'assessments') return {
      items: (await tx.unsalableAssessment.findMany({ where, orderBy: [{ asOfDate: 'desc' }, { createdAt: 'desc' }], take: 50 }))
        .map(row => ({ ...row, asOfDate: row.asOfDate.toISOString().slice(0, 10) })),
    };
    if (kind === 'options') return {
      wmsWarehouses: await tx.wmsWarehouse.findMany({ where: { ...where, enabled: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 200 }),
    };
    throw new WmsError('不支持的运营扩展查询类型。', 400);
  });
}

/** 主数据写入统一口径：行锁、revision 乐观锁、编码唯一由数据库约束兜底、每次变更留审计。 */
export async function saveOpsMaster(scope: WmsScope, kind: OpKind, body: Record<string, unknown>) {
  const id = body.id === undefined || body.id === null || body.id === '' ? null : requireText(body.id, '主数据 ID', 120);
  const revision = id ? requireRevision(body.revision) : 0;
  const draft = kind === 'carrier' ? parseCarrierDraft(body) : parseWarehouseDraft(body);
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, 'edit');
    if (id) {
      const table = kind === 'carrier' ? '"Carrier"' : '"ThirdPartyWarehouse"';
      await tx.$queryRawUnsafe(`SELECT id FROM ${table} WHERE "organizationId"=$1 AND "workspaceId"=$2 AND id=$3 FOR UPDATE`, scope.organizationId, scope.workspaceId, id);
      const current = kind === 'carrier'
        ? await tx.carrier.findFirst({ where: { ...scoped(scope), id } })
        : await tx.thirdPartyWarehouse.findFirst({ where: { ...scoped(scope), id } });
      if (!current) throw new WmsError('主数据不存在或不属于当前工作区。', 404);
      if (current.revision !== revision) throw new WmsError('主数据已被他人修改，请刷新后重试。', 409);
      const updated = kind === 'carrier'
        ? await tx.carrier.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } })
        : await tx.thirdPartyWarehouse.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditWms(tx, scope, `operations.${kind}.update`, id, json({ workspaceId: scope.workspaceId, code: draft.code, revision: updated.revision }));
      return updated;
    }
    const created = kind === 'carrier'
      ? await tx.carrier.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...draft, createdBy: scope.actorUserId } })
      : await tx.thirdPartyWarehouse.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...draft, createdBy: scope.actorUserId } });
    await auditWms(tx, scope, `operations.${kind}.create`, created.id, json({ workspaceId: scope.workspaceId, code: draft.code }));
    return created;
  });
}

async function readUnsalableInputs(tx: Prisma.TransactionClient, scope: WmsScope, warehouseId: string, policy: UnsalablePolicy): Promise<UnsalableInput[]> {
  const identity = scoped(scope);
  const stock = await tx.$queryRaw<Array<{ productRecordId: string; sku: string; onHand: number; ageDays: number }>>(Prisma.sql`
    SELECT p."id" AS "productRecordId", p."sku" AS sku,
           SUM(b."onHand" - b."reserved")::int AS "onHand",
           MAX(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - l."createdAt")) / 86400)))::int AS "ageDays"
    FROM "WmsStockBalance" b
    JOIN "WmsLot" l ON l."id" = b."lotId" AND l."organizationId" = b."organizationId" AND l."workspaceId" = b."workspaceId"
    JOIN "ProductRecord" p ON p."id" = l."productRecordId" AND p."organizationId" = l."organizationId" AND p."workspaceId" = l."workspaceId"
    WHERE b."organizationId" = ${identity.organizationId} AND b."workspaceId" = ${identity.workspaceId} AND b."warehouseId" = ${warehouseId}
    GROUP BY p."id", p."sku"`);
  if (!stock.length) return [];
  const windowStart = new Date(Date.now() - policy.salesWindowDays * 86400_000);
  const sales = await tx.$queryRaw<Array<{ sku: string; qty: number }>>(Prisma.sql`
    SELECT i."sellerSku" AS sku, SUM(i."quantityOrdered")::int AS qty
    FROM "AmazonOrderItemRecord" i
    JOIN "AmazonOrderRecord" o ON o."id" = i."orderRecordId" AND o."organizationId" = i."organizationId" AND o."workspaceId" = i."workspaceId" AND o."sourceId" = i."sourceId"
    WHERE i."organizationId" = ${identity.organizationId} AND i."workspaceId" = ${identity.workspaceId}
      AND o."createdTime" >= ${windowStart}
      AND COALESCE(o."rawStatus", '') NOT IN ('Cancelled', 'Canceled')
      AND i."sellerSku" IS NOT NULL
    GROUP BY i."sellerSku"`);
  const salesBySku = new Map(sales.map(row => [row.sku, Number(row.qty ?? 0)]));
  return stock.map(row => ({
    productRecordId: row.productRecordId, sku: row.sku,
    onHand: Number(row.onHand ?? 0), ageDays: Number(row.ageDays ?? 0),
    salesQty: salesBySku.get(row.sku) ?? 0,
  }));
}

/**
 * 滞销快照：只读库存、批次库龄与窗口销量，固化判定结果。
 * 同一仓库同一天重复采集时，只有来源完全一致才复用；来源变了不静默覆盖，避免报表口径漂移。
 */
export async function captureUnsalable(scope: WmsScope, body: Record<string, unknown>) {
  const warehouseId = requireText(body.warehouseId, '仓库 ID', 120);
  const asOfDate = requireText(body.asOfDate, '判定日期', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !Number.isFinite(Date.parse(asOfDate)) || new Date(asOfDate).toISOString().slice(0, 10) !== asOfDate) throw new WmsError('判定日期无效。', 400);
  const policyReference = requireText(body.policyReference, '判定口径依据', 1000);
  const policy = parseUnsalablePolicy(body);
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, 'edit');
    await tx.$queryRaw`SELECT id FROM "WmsWarehouse" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${warehouseId} FOR SHARE`;
    const warehouse = await tx.wmsWarehouse.findFirst({ where: { ...scoped(scope), id: warehouseId, enabled: true } });
    if (!warehouse) throw new WmsError('仓库不存在或已停用。', 404);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['unsalable', scope.organizationId, scope.workspaceId, warehouseId, asOfDate])}, 0))`;
    const inputs = await readUnsalableInputs(tx, scope, warehouseId, policy);
    const rows = unsalableRows(inputs, policy);
    const identity = { organizationId: scope.organizationId, workspaceId: scope.workspaceId, warehouseId, asOfDate };
    const sourceHash = unsalableFingerprint(rows, policy, identity);
    const prior = await tx.unsalableAssessment.findUnique({
      where: {
        organizationId_workspaceId_warehouseId_asOfDate: {
          ...identity, asOfDate: new Date(`${asOfDate}T00:00:00Z`),
        },
      },
    });
    if (prior) {
      if (prior.sourceHash === sourceHash) return { assessment: prior, reused: true };
      throw new WmsError('该仓库当天的判定快照已存在且来源不同，请换判定日期或核对口径，不覆盖既有结论。', 409);
    }
    const assessment = await tx.unsalableAssessment.create({ data: {
      id: crypto.randomUUID(), ...scoped(scope), warehouseId,
      asOfDate: new Date(`${asOfDate}T00:00:00Z`), policyReference,
      slowDays: policy.slowDays, minSalesQty: policy.minSalesQty,
      records: rows as unknown as Prisma.InputJsonValue, recordCount: rows.length,
      sourceHash, createdBy: scope.actorUserId,
    } });
    await auditWms(tx, scope, 'operations.unsalable.capture', assessment.id, json({
      workspaceId: scope.workspaceId, warehouseId, asOfDate, policy, recordCount: rows.length, sourceHash,
    }));
    return { assessment: { ...assessment, asOfDate }, reused: false };
  });
}
