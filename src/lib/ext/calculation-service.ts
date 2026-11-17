import { prisma } from '@/lib/db/prisma';
import { auditEntity, authorizeEntity, json, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import { quoteOnly } from './pricing';
import { requireEnum } from './rules';

export async function saveCalcScheme(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '方案 ID', 64) : null;
  const name = requireText(body.name, '方案名称', 80);
  const kind = requireEnum(body.kind, '测算类型', ['FBA_FEE', 'PROFIT'] as const, 'PROFIT');
  const inputs = body.inputs && typeof body.inputs === 'object' ? body.inputs as Record<string, unknown> : {};
  const result = quoteOnly(kind === 'FBA_FEE' ? 'fee' : 'profit', { ...inputs, ...(body.targetMarginBp === undefined ? {} : { targetMarginBp: body.targetMarginBp }) });
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const payload = {
      name, kind,
      marketplace: typeof body.marketplace === 'string' && body.marketplace ? body.marketplace : 'US',
      currency: typeof body.currency === 'string' && body.currency ? body.currency : 'CNY',
      inputs: json(inputs), result: json(result),
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : '',
    };
    if (id) {
      const current = await tx.calcScheme.findFirst({ where: { ...scoped(scope), id } });
      if (!current) throw new WmsError('测算方案不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('方案已被他人修改，请刷新后重试。', 409);
      const updated = await tx.calcScheme.update({ where: { id }, data: { ...payload, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'calc-scheme.update', id, { name, kind });
      return updated;
    }
    const created = await tx.calcScheme.create({ data: { id: crypto.randomUUID(), ...scoped(scope), ...payload, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'calc-scheme.create', created.id, { name, kind });
    return created;
  });
}

export async function deleteCalcScheme(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '方案 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const current = await tx.calcScheme.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('测算方案不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('方案已被他人修改，请刷新后重试。', 409);
    await tx.calcScheme.delete({ where: { id } });
    await auditEntity(tx, scope, 'calc-scheme.delete', id, { name: current.name });
    return { ok: true };
  });
}
