import {createHash,randomUUID} from 'node:crypto';
import {prisma} from '@/lib/db/prisma';
import {getStorageDriver,getStorageType} from '@/lib/storage';
import {authorizeWms,assertWmsAccess,scoped} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireText} from '@/lib/wms/rules';
import {lockKey} from '@/lib/wms/repository';
import {authorizeFbaAccount} from './account-access';
import {parseLocalPacking} from './packing';
import {parseShipmentLabelRequest,renderShipmentLabels} from './shipment-label-rules';

/** Bounded-download ceiling; rendered labels must stay below it too. */
export const shipmentLabelMaxBytes = 1024 * 1024;
/** Per-plan label cap, aligned with the per-plan shipment-document cap. */
export const shipmentLabelLimit = 100;

/**
 * Generate a local internal label (HTML), persist the FileObject + label row +
 * audit in a single transaction, and write the file to the configured driver.
 * No Amazon box/placement/warehouse codes are produced or consumed.
 */
export async function createShipmentLabel(scope: WmsScope, raw: unknown) {
  const input = parseShipmentLabelRequest(raw);
  const storage = getStorageDriver();
  const storageType = getStorageType();
  // Hoisted so a rolled-back transaction can remove an unbound file (finance pattern).
  let orphanKey: string | null = null;
  let orphanLabelId: string | null = null;
  try {
    return await prisma.$transaction(async tx => {
      await authorizeWms(tx, scope, 'edit');
      const identity = scoped(scope);
      const shipment = await tx.fbaLocalShipment.findFirst({
        where: {...identity, id: input.shipmentId},
        include: {items: true},
      });
      if (!shipment) throw new WmsError('货件不存在。', 404);
      const plan = await tx.fbaLocalPlan.findFirst({
        where: {...identity, id: shipment.planId},
        include: {lines: {select: {id: true, quantity: true}}},
      });
      if (!plan || plan.id !== shipment.planId) throw new WmsError('计划与货件不匹配。', 404);
      if (plan.status === 'CANCELLED') throw new WmsError('计划已取消，不能生成标签。', 409);
      await authorizeFbaAccount(tx, scope, plan.sellerAccountId, plan.marketplaceId);

      if (!plan.packing) throw new WmsError('请先保存装箱资料再生成标签。', 409);
      const packing = parseLocalPacking(plan.packing, plan.lines);
      const skuByLine = new Map<string, {sellerSku?: string; fnsku?: string}>();
      for (const item of shipment.items) skuByLine.set(item.planLineId, {sellerSku: item.sellerSku, fnsku: item.fnsku ?? undefined});
      const selectedBoxes = input.boxNumbers
        ? input.boxNumbers.map(number => {
            const box = packing.boxes.find(candidate => candidate.number === number);
            if (!box) throw new WmsError('标签箱号不属于当前装箱资料。', 422);
            return box;
          })
        : packing.boxes;
      const boxes = selectedBoxes.map(box => ({
        number: box.number,
        lengthCm: box.lengthCm,
        widthCm: box.widthCm,
        heightCm: box.heightCm,
        grossWeightKg: box.grossWeightKg,
        items: box.items.map(item => ({...(skuByLine.get(item.lineId) ?? {}), quantity: item.quantity})),
      }));

      // Stable request identity: generatedAt is deliberately excluded so retries reuse the stored label.
      const requestHash = createHash('sha256').update(JSON.stringify({
        planId: plan.id, shipmentId: shipment.id, kind: input.kind,
        boxNumbers: input.boxNumbers ?? null, planNumber: plan.number,
        shipmentName: shipment.spApiShipmentId, boxes,
      })).digest('hex');
      await lockKey(tx, JSON.stringify(['fba-local-label', identity, plan.id, input.idempotencyKey]));
      const prior = await tx.fbaLocalShipmentLabel.findFirst({where: {...identity, planId: plan.id, idempotencyKey: input.idempotencyKey}});
      if (prior) {
        if (prior.requestHash !== requestHash || prior.createdBy !== scope.actorUserId) throw new WmsError('标签幂等键冲突。', 409);
        return {labelId: prior.id, reused: true};
      }
      if (await tx.fbaLocalShipmentLabel.count({where: {...identity, planId: plan.id}}) >= shipmentLabelLimit) throw new WmsError('每计划最多生成 100 份标签。', 422);

      const html = renderShipmentLabels({
        planNumber: plan.number, shipmentName: shipment.spApiShipmentId,
        kind: input.kind, boxes, generatedAt: new Date().toISOString(),
      });
      const buffer = Buffer.from(html, 'utf8');
      if (buffer.length > shipmentLabelMaxBytes) throw new WmsError('标签内容超出 1MB 上限。', 413);
      const contentHash = createHash('sha256').update(buffer).digest('hex');

      const fileId = randomUUID(), labelId = randomUUID();
      const key = `fba-local-labels/${scope.organizationId}/${scope.workspaceId}/${plan.id}/${randomUUID()}.html`;
      orphanKey = key; orphanLabelId = labelId;
      await storage.putBuffer({key, buffer, contentType: 'text/html; charset=utf-8'});
      await tx.fileObject.create({data: {
        id: fileId, ...identity, userId: scope.actorUserId,
        originalName: `fba-local-label-${labelId}.html`,
        mimeType: 'text/html; charset=utf-8', size: buffer.length,
        storageKey: key, storageType, status: 'done', contentHash,
      }});
      await tx.fbaLocalShipmentLabel.create({data: {
        id: labelId, ...identity, planId: plan.id, shipmentId: shipment.id,
        kind: input.kind, fileId, contentHash, requestHash,
        idempotencyKey: input.idempotencyKey, createdBy: scope.actorUserId,
      }});
      await tx.auditLog.create({data: {
        organizationId: scope.organizationId, userId: scope.actorUserId,
        action: 'fba-local.label.create', entityType: 'FbaLocalShipment', entityId: shipment.id,
        metadata: {workspaceId: scope.workspaceId, planId: plan.id, labelId, kind: input.kind, contentHash, requestHash},
      }});
      return {labelId, reused: false};
    });
  } catch (error) {
    // A lost commit response must never delete a file that may already be bound.
    if (orphanKey) {
      try {
        const bound = orphanLabelId ? await prisma.fbaLocalShipmentLabel.findUnique({where: {id: orphanLabelId}, select: {id: true}}) : null;
        if (!bound) await storage.delete(orphanKey);
      } catch { console.error('[fba-local.label.orphan-check]', {labelId: orphanLabelId}); }
    }
    throw error;
  }
}

/** Controlled, bounded, hash-verified download; never returns the storage key or a public URL. */
export async function downloadShipmentLabel(scope: WmsScope, labelId: string) {
  const storage = getStorageDriver();
  const storageType = getStorageType();
  return prisma.$transaction(async tx => {
    await assertWmsAccess(tx, {...scope, userId: scope.actorUserId, action: 'view'});
    const identity = scoped(scope);
    const id = requireText(labelId, '标签 ID');
    const label = await tx.fbaLocalShipmentLabel.findFirst({where: {...identity, id}});
    if (!label) throw new WmsError('标签不存在。', 404);
    const plan = await tx.fbaLocalPlan.findFirst({where: {...identity, id: label.planId}, select: {sellerAccountId: true, marketplaceId: true}});
    if (!plan) throw new WmsError('标签关联计划不存在。', 404);
    await authorizeFbaAccount(tx, scope, plan.sellerAccountId, plan.marketplaceId);
    const file = await tx.fileObject.findFirst({where: {...identity, id: label.fileId}});
    if (!file || file.status !== 'done') throw new WmsError('标签文件不可用。', 404);
    if (file.storageType !== storageType || !storage.getBoundedBuffer) throw new WmsError('当前存储适配器无法受控读取该标签。', 503);
    const buffer = await storage.getBoundedBuffer(file.storageKey, shipmentLabelMaxBytes);
    if (createHash('sha256').update(buffer).digest('hex') !== label.contentHash) throw new WmsError('标签完整性校验失败。', 409);
    await tx.auditLog.create({data: {
      organizationId: scope.organizationId, userId: scope.actorUserId,
      action: 'fba-local.label.download', entityType: 'FbaLocalShipment', entityId: label.shipmentId,
      metadata: {workspaceId: scope.workspaceId, labelId: label.id, contentHash: label.contentHash},
    }});
    return {name: file.originalName, mimeType: file.mimeType ?? 'text/html; charset=utf-8', buffer};
  });
}
