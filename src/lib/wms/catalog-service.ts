import {createCostRule} from './valuation-service';
import {createOverseasManifest} from './overseas-service';
import {createConsumable} from './consumable-service';
import {createCatalogDetails} from './catalog-details-service';
import {createTransferOrder} from './transfer-order-service';
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { authorizeWms, auditWms, scoped } from "./access";
import { WmsError, type WmsScope } from "./contracts";
import { normalizeCode, requireText, requirePositiveQuantity, strictKeys, wmsMaxReceiptLines, requireRevision } from "./rules";
import { activeLocation, lockKey } from "./repository";
import { createStocktake } from "./stocktake-service";
export type CatalogKind = "cost-rules" | "overseas-transfers" | "consumables" | "warehouse-types" | "warehouse-addresses" | "transfer-orders" | "warehouses" | "areas" | "locations" | "lots" | "receipts" | "stocktakes" | "outbounds";
export async function createWmsResource(scope: WmsScope, kind: CatalogKind, body: Record<string, unknown>) {
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "create");
    return createWmsResourceInTransaction(tx, scope, kind, body);
  });
}

/** Caller must authorize WMS create in this same transaction. */
export async function createWmsResourceInTransaction(tx: Prisma.TransactionClient, scope: WmsScope, kind: CatalogKind, body: Record<string, unknown>) {
    const base = { ...scoped(scope), id: crypto.randomUUID() };
    let result;
    if(kind==="cost-rules"){result=await createCostRule(tx,scope,body);
    }else if(kind==="overseas-transfers"){result=await createOverseasManifest(tx,scope,body);
    }else if(kind==="consumables"){result=await createConsumable(tx,scope,body);
    }else if(kind==="warehouse-types"||kind==="warehouse-addresses"){result=await createCatalogDetails(tx,scope,kind,body);
    }else if(kind==="transfer-orders"){result=await createTransferOrder(tx,scope,body);
    }else if (kind === "stocktakes") {
      result = await createStocktake(tx, scope, body);
    } else if (kind === "outbounds") {
      strictKeys(body, ["warehouseId", "number", "customer", "deliveryAddress", "carrier", "trackingNumber", "remark", "lines"]);
      const warehouseId = requireText(body.warehouseId, "仓库 ID");
      const warehouse = await tx.wmsWarehouse.findFirst({ where: { ...scoped(scope), id: warehouseId, enabled: true } });
      if (!warehouse) throw new WmsError("仓库不存在或未启用。", 422);
      if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > wmsMaxReceiptLines) throw new WmsError("出库明细须为 1-100 行。", 400);
      const seen = new Set<string>();
      const lines = body.lines.map(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsError("出库明细无效。", 400);
        const line = raw as Record<string, unknown>;
        strictKeys(line, ["productRecordId", "requestedQty"]);
        const productRecordId = requireText(line.productRecordId, "商品 ID");
        if (seen.has(productRecordId)) throw new WmsError("同一商品请合并为一行需求。", 422);
        seen.add(productRecordId);
        return { ...scoped(scope), id: crypto.randomUUID(), warehouseId, productRecordId, requestedQty: requirePositiveQuantity(line.requestedQty) };
      });
      for (const line of lines) if (!await tx.productRecord.findFirst({ where: { ...scoped(scope), id: line.productRecordId }, select: { id: true } })) throw new WmsError("商品不属于当前工作区。", 422);
      const outbound = await tx.wmsOutbound.create({ data: { ...base, warehouseId, number: requireText(body.number, "出库单号"), customer: body.customer ? requireText(body.customer, "客户") : null, deliveryAddress: body.deliveryAddress ? requireText(body.deliveryAddress, "收货地址", 500) : null, carrier: body.carrier ? requireText(body.carrier, "承运商") : null, trackingNumber: body.trackingNumber ? requireText(body.trackingNumber, "物流单号") : null, remark: body.remark ? requireText(body.remark, "备注", 1000) : null, createdBy: scope.actorUserId } });
      await tx.wmsOutboundLine.createMany({ data: lines.map(line => ({ ...line, outboundId: outbound.id })) });
      result = await tx.wmsOutbound.findUniqueOrThrow({ where: { id: outbound.id }, include: { lines: true } });
    } else if (kind === "warehouses") {
      strictKeys(body, ["code", "name"]);
      result = await tx.wmsWarehouse.create({ data: { ...base, code: normalizeCode(body.code, "仓库编码"), name: requireText(body.name, "仓库名称") } });
    } else if (kind === "areas") {
      strictKeys(body, ["warehouseId", "code", "name"]);
      const warehouseId = requireText(body.warehouseId, "仓库 ID");
      await tx.$queryRaw`SELECT id FROM "WmsWarehouse" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${warehouseId} FOR SHARE`;
      if (!await tx.wmsWarehouse.findFirst({ where: { ...scoped(scope), id: warehouseId, enabled: true } })) throw new WmsError("仓库不可用。", 422);
      result = await tx.wmsArea.create({ data: { ...base, warehouseId, code: normalizeCode(body.code, "区域编码"), name: requireText(body.name, "区域名称") } });
    } else if (kind === "locations") {
      strictKeys(body, ["areaId", "code", "kind"]);
      const areaId = requireText(body.areaId, "区域 ID");
      await tx.$queryRaw`SELECT a.id FROM "WmsArea" a JOIN "WmsWarehouse" w ON w."organizationId"=a."organizationId" AND w."workspaceId"=a."workspaceId" AND w.id=a."warehouseId" WHERE a."organizationId"=${scope.organizationId} AND a."workspaceId"=${scope.workspaceId} AND a.id=${areaId} FOR SHARE OF w,a`;
      const area = await tx.wmsArea.findFirst({ where: { ...scoped(scope), id: areaId, enabled: true, warehouse: { enabled: true } } });
      if (!area || !["RECEIVING", "STORAGE"].includes(String(body.kind))) throw new WmsError("区域或库位类型无效。", 422);
      result = await tx.wmsLocation.create({ data: { ...base, areaId: area.id, warehouseId: area.warehouseId, code: normalizeCode(body.code, "库位编码"), kind: String(body.kind) } });
    } else if (kind === "lots") {
      strictKeys(body, ["productRecordId", "lotCode", "barcode"]);
      const productRecordId = requireText(body.productRecordId, "商品 ID");
      if (!await tx.productRecord.findFirst({ where: { ...scoped(scope), id: productRecordId } })) throw new WmsError("商品不属于当前工作区。", 422);
      result = await tx.wmsLot.create({ data: { ...base, productRecordId, lotCode: requireText(body.lotCode, "批次号"), barcode: body.barcode ? requireText(body.barcode, "条码") : null } });
    } else {
      strictKeys(body, ["receivingLocationId", "number", "sourceReference", "lines"]);
      const location = await activeLocation(tx, scope, requireText(body.receivingLocationId, "收货库位"), undefined, "RECEIVING");
      if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > wmsMaxReceiptLines) throw new WmsError("收货明细须为 1-100 行。", 400);
      const seen = new Set<string>();
      const lines = [];
      for (const raw of body.lines) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsError("收货明细无效。", 400);
        const line = raw as Record<string, unknown>;
        strictKeys(line, ["lotId", "expectedQty"]);
        const lotId = requireText(line.lotId, "批次 ID");
        if (seen.has(lotId) || !await tx.wmsLot.findFirst({ where: { ...scoped(scope), id: lotId } })) throw new WmsError("批次重复或不可访问。", 422);
        seen.add(lotId);
        lines.push({ ...scoped(scope), id: crypto.randomUUID(), lotId, expectedQty: requirePositiveQuantity(line.expectedQty) });
      }
      result = await tx.wmsReceipt.create({ data: { ...base, warehouseId: location.warehouseId, receivingLocationId: location.id, number: requireText(body.number, "收货单号"), sourceReference: body.sourceReference ? requireText(body.sourceReference, "来源单号") : null, createdBy: scope.actorUserId } });
      const receiptId: string = result.id;
      await tx.wmsReceiptLine.createMany({ data: lines.map(line => ({ ...line, receiptId })) });
      result = await tx.wmsReceipt.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    }
    await auditWms(tx, scope, `${kind}.create`, result.id);
    return result;
}

export async function setWmsResourceEnabled(scope: WmsScope, kind: "warehouses" | "areas" | "locations", body: Record<string, unknown>) {
  strictKeys(body, ["id", "enabled", "revision"]);
  const id = requireText(body.id, "记录 ID");
  const revision = requireRevision(body.revision);
  if (typeof body.enabled !== "boolean") throw new WmsError("启用状态无效。", 400);
  const desiredEnabled = body.enabled;

  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "edit");
    await lockKey(tx, JSON.stringify([scope.organizationId, scope.workspaceId, kind, id]));
    if (kind === "areas") await tx.$queryRaw`SELECT w.id FROM "WmsArea" a JOIN "WmsWarehouse" w ON w."organizationId"=a."organizationId" AND w."workspaceId"=a."workspaceId" AND w.id=a."warehouseId" WHERE a."organizationId"=${scope.organizationId} AND a."workspaceId"=${scope.workspaceId} AND a.id=${id} FOR SHARE OF w`;
    if (kind === "locations") await tx.$queryRaw`SELECT a.id FROM "WmsLocation" l JOIN "WmsArea" a ON a."organizationId"=l."organizationId" AND a."workspaceId"=l."workspaceId" AND a."warehouseId"=l."warehouseId" AND a.id=l."areaId" JOIN "WmsWarehouse" w ON w."organizationId"=l."organizationId" AND w."workspaceId"=l."workspaceId" AND w.id=l."warehouseId" WHERE l."organizationId"=${scope.organizationId} AND l."workspaceId"=${scope.workspaceId} AND l.id=${id} FOR SHARE OF w,a`;
    if (kind === "warehouses") await tx.$queryRaw`SELECT id FROM "WmsWarehouse" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    if (kind === "areas") await tx.$queryRaw`SELECT id FROM "WmsArea" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;
    if (kind === "locations") await tx.$queryRaw`SELECT id FROM "WmsLocation" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${id} FOR UPDATE`;

    let enabled: boolean | undefined;
    let currentRevision: number | undefined;
    let warehouseId = id;
    let parentsEnabled = true;
    if (kind === "warehouses") {
      const resource = await tx.wmsWarehouse.findFirst({ where: { ...scoped(scope), id }, select: { enabled: true, revision: true } });
      enabled = resource?.enabled; currentRevision = resource?.revision;
    } else if (kind === "areas") {
      const resource = await tx.wmsArea.findFirst({ where: { ...scoped(scope), id }, include: { warehouse: { select: { enabled: true } } } });
      enabled = resource?.enabled; currentRevision = resource?.revision; warehouseId = resource?.warehouseId ?? id; parentsEnabled = resource?.warehouse.enabled ?? false;
    } else {
      const resource = await tx.wmsLocation.findFirst({ where: { ...scoped(scope), id }, include: { area: { include: { warehouse: { select: { enabled: true } } } } } });
      enabled = resource?.enabled; currentRevision = resource?.revision; warehouseId = resource?.warehouseId ?? id; parentsEnabled = Boolean(resource?.area.enabled && resource.area.warehouse.enabled);
    }
    if (enabled === undefined || currentRevision === undefined) throw new WmsError("记录不存在。", 404);
    if (currentRevision !== revision) throw new WmsError("记录已变更，请刷新后重试。", 409);
    if (enabled === desiredEnabled) return { id, enabled, revision };

    if (desiredEnabled && !parentsEnabled) throw new WmsError("请先启用所属仓库和区域。", 422);
    if (!desiredEnabled) {
      const nonzero = { OR: [{ onHand: { not: 0 } }, { pendingQc: { not: 0 } }, { pendingPutaway: { not: 0 } }, { rejected: { not: 0 } }, { reserved: { not: 0 } }] };
      const balance = kind === "warehouses"
        ? await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), warehouseId, ...nonzero }, select: { id: true } })
        : kind === "areas"
          ? await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), warehouseId, location: { areaId: id }, ...nonzero }, select: { id: true } })
          : await tx.wmsStockBalance.findFirst({ where: { ...scoped(scope), locationId: id, ...nonzero }, select: { id: true } });
      if (balance) throw new WmsError("该范围仍有库存或预留数量，不能停用。", 409);
      const transit = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
        SELECT t.id FROM "WmsTransferOrderLine" t
        JOIN "WmsLocation" l ON l."organizationId"=t."organizationId" AND l."workspaceId"=t."workspaceId" AND l.id=t."targetLocationId"
        WHERE t."organizationId"=${scope.organizationId} AND t."workspaceId"=${scope.workspaceId}
        AND t."shippedQty">t."receivedQty"
        AND ${kind === 'warehouses' ? Prisma.sql`l."warehouseId"=${id}` : kind === 'areas' ? Prisma.sql`l."areaId"=${id}` : Prisma.sql`l.id=${id}`} LIMIT 1`);
      if (transit.length) throw new WmsError("该范围仍有在途待签收库存，不能停用。", 409);
    }

    const update = { where: { ...scoped(scope), id, revision }, data: { enabled: desiredEnabled, revision: { increment: 1 } } };
    const changed = kind === "warehouses" ? await tx.wmsWarehouse.updateMany(update) : kind === "areas" ? await tx.wmsArea.updateMany(update) : await tx.wmsLocation.updateMany(update);
    if (changed.count !== 1) throw new WmsError("记录已变更，请刷新后重试。", 409);
    await auditWms(tx, scope, `${kind}.${desiredEnabled ? "enable" : "disable"}`, id);
    return { id, enabled: desiredEnabled, revision: revision + 1 };
  });
}
