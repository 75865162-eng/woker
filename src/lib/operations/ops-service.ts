import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditWms, authorizeWms, json, scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import {
  parseCarrierDraft, parseUnsalablePolicy, parseWarehouseDraft,
  unsalableFingerprint, unsalableRows, type CarrierDraft, type UnsalableInput, type UnsalablePolicy, type WarehouseDraft,
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
      ? await tx.carrier.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...(draft as CarrierDraft), createdBy: scope.actorUserId } })
      : await tx.thirdPartyWarehouse.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...(draft as WarehouseDraft), createdBy: scope.actorUserId } });
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
  const identities = await tx.$queryRaw<Array<{ productRecordId: string; listingCount: number }>>(Prisma.sql`
    SELECT p."id" AS "productRecordId", COUNT(DISTINCT jsonb_build_array(li->>'sellerAccountId', li->>'marketplaceId', li->>'sellerSku'))::int AS "listingCount"
    FROM "ProductRecord" p
    JOIN "WmsLot" l ON l."productRecordId" = p."id" AND l."organizationId" = p."organizationId" AND l."workspaceId" = p."workspaceId"
    JOIN "WmsStockBalance" b ON b."lotId" = l."id" AND b."organizationId" = l."organizationId" AND b."workspaceId" = l."workspaceId"
    LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.payload->'management'->'listingIdentifiers') = 'array' THEN p.payload->'management'->'listingIdentifiers' ELSE '[]'::jsonb END) li ON true
    WHERE b."organizationId" = ${identity.organizationId} AND b."workspaceId" = ${identity.workspaceId} AND b."warehouseId" = ${warehouseId} AND b."onHand" > b."reserved"
    GROUP BY p."id"`);
  if (identities.some(row => Number(row.listingCount) !== 1)) throw new WmsError('库存商品缺少唯一 Amazon 刊登标识，无法安全匹配卖家/站点销量。请先完善商品管理中的刊登标识后重试。', 409);
  const windowStart = new Date(Date.now() - policy.salesWindowDays * 86400_000);
  const sales = await tx.$queryRaw<Array<{ productRecordId: string; qty: number }>>(Prisma.sql`
    WITH stock_identity AS (
      SELECT DISTINCT p."id" AS "productRecordId", li->>'sellerAccountId' AS "sellerAccountId", li->>'marketplaceId' AS "marketplaceId", li->>'sellerSku' AS "sellerSku"
      FROM "WmsStockBalance" b
      JOIN "WmsLot" l ON l."id" = b."lotId" AND l."organizationId" = b."organizationId" AND l."workspaceId" = b."workspaceId"
      JOIN "ProductRecord" p ON p."id" = l."productRecordId" AND p."organizationId" = l."organizationId" AND p."workspaceId" = l."workspaceId"
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.payload->'management'->'listingIdentifiers') = 'array' THEN p.payload->'management'->'listingIdentifiers' ELSE '[]'::jsonb END) li
      WHERE b."organizationId" = ${identity.organizationId} AND b."workspaceId" = ${identity.workspaceId} AND b."warehouseId" = ${warehouseId} AND b."onHand" > b."reserved"
    )
    SELECT si."productRecordId", SUM(i."quantityOrdered")::int AS qty
    FROM stock_identity si
    JOIN "AmazonSellerBinding" sb ON sb."organizationId" = ${identity.organizationId} AND sb."workspaceId" = ${identity.workspaceId} AND sb."sellerAccountId" = si."sellerAccountId" AND sb."marketplaceId" = si."marketplaceId"
    JOIN "AmazonOrderRecord" o ON o."organizationId" = ${identity.organizationId} AND o."workspaceId" = ${identity.workspaceId} AND o."sellerAccountId" = sb."sellerAccountId" AND o."marketplaceId" = sb."marketplaceId" AND o."amazonSellerId" = sb."amazonSellerId"
    JOIN "AmazonOrderItemRecord" i ON i."organizationId" = o."organizationId" AND i."workspaceId" = o."workspaceId" AND i."sourceId" = o."sourceId" AND i."orderRecordId" = o."id" AND i."sellerSku" = si."sellerSku"
    WHERE o."createdTime" >= ${windowStart} AND COALESCE(o."rawStatus", '') NOT IN ('Cancelled', 'Canceled')
    GROUP BY si."productRecordId"`);
  const salesByProduct = new Map(sales.map(row => [row.productRecordId, Number(row.qty ?? 0)]));
  return stock.map(row => ({
    productRecordId: row.productRecordId, sku: row.sku,
    onHand: Number(row.onHand ?? 0), ageDays: Number(row.ageDays ?? 0),
    salesQty: salesByProduct.get(row.productRecordId) ?? 0,
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
