import { prisma } from '@/lib/db/prisma';
import type { Tx } from '@/lib/wms/repository';
import { scoped, json } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireText, requireRevision, strictKeys } from '@/lib/wms/rules';
import { parseAuxiliaryAssignments, validateAuxiliaryAssignments } from './auxiliary-rules';
import { assertFinanceReviewer,assertFinanceAction } from './access';
import { closeDigest } from './close-rules';

/** All catalogs are append-only. Target policies and codes are explicit, never seeded as accounting defaults. */
export async function queryFinanceAuxiliary(scope: WmsScope, params: URLSearchParams) {
  const bookId = requireText(params.get('bookId'), '账套 ID');
  return prisma.$transaction(async tx => {
    await assertFinanceAction(tx,scope,'view');
    const where = { ...scoped(scope), bookId };
    const [types, items, rules, voucherTypes] = await Promise.all([
      tx.financeAuxiliaryType.findMany({ where, orderBy: { code: 'asc' }, take: 201 }),
      tx.financeAuxiliaryItem.findMany({ where, orderBy: [{ typeId: 'asc' }, { code: 'asc' }], take: 501 }),
      tx.financeSubjectAuxiliary.findMany({ where, orderBy: [{ subjectId: 'asc' }, { typeId: 'asc' }], take: 501 }),
      tx.financeVoucherType.findMany({ where, orderBy: { code: 'asc' }, take: 201 }),
    ]);
    const voucherId = params.get('voucherId');
    const assignments = voucherId ? await tx.financeVoucherAuxiliary.findMany({ where: { ...where, voucherId }, orderBy: [{ lineNumber: 'asc' }, { typeId: 'asc' }] }) : [];
    const profile = voucherId ? await tx.financeVoucherProfile.findFirst({ where: { ...where, voucherId } }) : null;
    return { types: types.slice(0, 200), items: items.slice(0, 500), rules: rules.slice(0, 500), voucherTypes: voucherTypes.slice(0, 200), assignments, profile, truncated: { types: types.length > 200, items: items.length > 500, rules: rules.length > 500, voucherTypes: voucherTypes.length > 200 } };
  }, { isolationLevel: 'RepeatableRead' });
}
export async function validateVoucherAuxiliary(tx: Tx, scope: WmsScope, voucherId: string, bookId: string, kind: string) {
  // A reversal inherits its posted original's dimensions, regardless of later catalog policy changes.
  if (kind === 'REVERSAL') return { basis: 'INHERITED_REVERSAL', rules: [], assignments: [] };
  const where = { ...scoped(scope), bookId };
  const lines = await tx.financeVoucherLine.findMany({ where: { ...where, voucherId }, select: { lineNumber: true, subjectId: true } });
  const [rules, assignments] = await Promise.all([
    tx.financeSubjectAuxiliary.findMany({ where: { ...where, subjectId: { in: lines.map(row => row.subjectId) } } }),
    tx.financeVoucherAuxiliary.findMany({ where: { ...where, voucherId } }),
  ]);
  validateAuxiliaryAssignments(lines, rules, assignments);
  if(await tx.financeAuxiliaryItem.count({where:{...where,id:{in:[...new Set(assignments.map(row=>row.itemId))]},enabled:true}})!==new Set(assignments.map(row=>row.itemId)).size)throw new WmsError('辅助项目已停用，须在审核前重新确认。',409);
  return { basis: 'REVIEW_POLICY_SNAPSHOT', rules: rules.map(({ subjectId, typeId, required, policyReference }) => ({ subjectId, typeId, required, policyReference })).sort((a,b)=>a.subjectId.localeCompare(b.subjectId)||a.typeId.localeCompare(b.typeId)), assignments: assignments.map(({ lineNumber, typeId, itemId }) => ({ lineNumber, typeId, itemId })).sort((a,b)=>a.lineNumber-b.lineNumber||a.typeId.localeCompare(b.typeId)) };
}

/** Reviewed vouchers keep their reviewed policy; later rules cannot strand immutable evidence. */
export async function assertReviewedVoucherAuxiliary(tx: Tx, scope: WmsScope, voucherId: string, bookId: string, revision: number) {
  const review = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: 'finance.voucher.review', entityType: 'FinanceVoucher', entityId: voucherId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { metadata: true } });
  const metadata = review?.metadata as Record<string, unknown> | undefined;
  if (!metadata || metadata.revision !== revision || metadata.workspaceId !== scope.workspaceId || !metadata.auxiliaryEvidence || typeof metadata.auxiliaryEvidence !== 'object') throw new WmsError('凭证缺少对应审核版本的辅助核算证据。', 409);
  const evidence = metadata.auxiliaryEvidence as Record<string, unknown>;
  const assignments = await tx.financeVoucherAuxiliary.findMany({ where: { ...scoped(scope), bookId, voucherId } });
  const normalized = assignments.map(({ lineNumber, typeId, itemId })=>({ lineNumber, typeId, itemId })).sort((a,b)=>a.lineNumber-b.lineNumber||a.typeId.localeCompare(b.typeId));
  if (evidence.basis !== 'INHERITED_REVERSAL' && closeDigest(normalized) !== closeDigest(parseAuxiliaryAssignments(evidence.assignments))) throw new WmsError('辅助核算与审核版本不一致。', 409);
}

export async function copyVoucherAuxiliary(tx: Tx, scope: WmsScope, bookId: string, originalId: string, voucherId: string) {
  const where = { ...scoped(scope), bookId, voucherId: originalId };
  const [assignments, profile] = await Promise.all([tx.financeVoucherAuxiliary.findMany({ where }), tx.financeVoucherProfile.findFirst({ where })]);
  if (assignments.length) await tx.financeVoucherAuxiliary.createMany({ data: assignments.map(row => ({ ...scoped(scope), bookId, voucherId, id: crypto.randomUUID(), lineNumber: row.lineNumber, typeId: row.typeId, itemId: row.itemId })) });
  const attachments = await tx.financeVoucherAttachment.findMany({ where });
  if (attachments.length) await tx.financeVoucherAttachment.createMany({ data: attachments.map(row => ({ ...scoped(scope), bookId, voucherId, id: crypto.randomUUID(), fileId: row.fileId, contentHash: row.contentHash, evidence: `冲销沿用 ${originalId}：${row.evidence}`, createdBy: scope.actorUserId })) });
  if (profile) await tx.financeVoucherProfile.create({ data: { ...scoped(scope), bookId, voucherId, id: crypto.randomUUID(), voucherTypeId: profile.voucherTypeId, evidence: `冲销沿用 ${originalId}：${profile.evidence}`, createdBy: scope.actorUserId } });
}
export async function mutateFinanceAuxiliary(scope: WmsScope, body: Record<string, unknown>) {
  const action = requireText(body.action, '辅助核算动作'), bookId = requireText(body.bookId, '账套 ID');
  const fields: Record<string, string[]> = {
    'create-type': ['code', 'name'], 'create-item': ['typeId', 'code', 'name','isFixed'],'update-item':['itemId','revision','name','enabled'],'delete-item':['itemId','revision'],
    'configure-subject': ['subjectId', 'typeId', 'required', 'policyReference'],
    'create-voucher-type': ['code', 'name', 'policyReference'],
    'annotate-voucher': ['voucherId', 'revision', 'assignments', 'voucherTypeId', 'evidence'],
  };
  if (!fields[action]) throw new WmsError('辅助核算动作不支持。', 400);
  strictKeys(body, ['action', 'bookId', ...fields[action]]);
  return prisma.$transaction(async tx => {
    await assertFinanceAction(tx,scope,action==='annotate-voucher'?'create':'approve');
    await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
    const where = { ...scoped(scope), bookId };
    if (!await tx.financeBook.findFirst({ where: { ...scoped(scope), id: bookId, enabled: true } })) throw new WmsError('账套不存在或已停用。', 404);
    let result: object;
    if (action === 'annotate-voucher') {
      const voucherId = requireText(body.voucherId, '凭证 ID'), revision = requireRevision(body.revision), assignments = parseAuxiliaryAssignments(body.assignments);
      const voucher = await tx.financeVoucher.findFirst({ where: { ...where, id: voucherId }, include: { period: true, lines: true } });
      if (!voucher || voucher.status !== 'DRAFT' || voucher.kind !== 'STANDARD' || voucher.period.status !== 'OPEN' || voucher.revision !== revision) throw new WmsError('仅当前版本开放期间的普通草稿可编辑辅助核算。', 409);
      const rules = await tx.financeSubjectAuxiliary.findMany({ where: { ...where, subjectId: { in: voucher.lines.map(line => line.subjectId) } } });
      validateAuxiliaryAssignments(voucher.lines, rules, assignments);
      const itemKeys = [...new Set(assignments.map(row => row.itemId))];
      const items = await tx.financeAuxiliaryItem.findMany({ where: { ...where, id: { in: itemKeys },enabled:true } });
      if (assignments.some(row => !items.some(item => item.id === row.itemId && item.typeId === row.typeId))) throw new WmsError('辅助项目不属于当前账套或所选类型。', 422);
      const voucherTypeId = body.voucherTypeId == null || body.voucherTypeId === '' ? null : requireText(body.voucherTypeId, '凭证类别 ID');
      const evidence = requireText(body.evidence, '辅助核算依据', 1000);
      if (voucherTypeId && !await tx.financeVoucherType.findFirst({ where: { ...where, id: voucherTypeId } })) throw new WmsError('凭证类别不属于当前账套。', 422);
      await tx.financeVoucherAuxiliary.deleteMany({ where: { ...where, voucherId } });
      if (assignments.length) await tx.financeVoucherAuxiliary.createMany({ data: assignments.map(row => ({ ...where, ...row, id: crypto.randomUUID(), voucherId })) });
      await tx.financeVoucherProfile.deleteMany({ where: { ...where, voucherId } });
      if (voucherTypeId) await tx.financeVoucherProfile.create({ data: { ...where, id: crypto.randomUUID(), voucherId, voucherTypeId, evidence, createdBy: scope.actorUserId } });
      const updated = await tx.financeVoucher.update({ where: { id: voucherId }, data: { revision: { increment: 1 } } });
      result = { voucher: updated, assignments };
    } else {
      await assertFinanceReviewer(tx, scope, scope.actorUserId);
      if(body.isFixed!==undefined&&typeof body.isFixed!=='boolean')throw new WmsError('系统项目标识无效。',400);
      const data = { ...where, id: crypto.randomUUID(), createdBy: scope.actorUserId };
      if(action==='update-item'||action==='delete-item'){
       const id=requireText(body.itemId,'辅助项目 ID'),revision=requireRevision(body.revision),item=await tx.financeAuxiliaryItem.findFirst({where:{...where,id}});if(!item||item.revision!==revision)throw new WmsError('项目不存在或版本已变化。',409);
       if(action==='delete-item'){if(item.isFixed||await tx.financeVoucherAuxiliary.count({where:{...where,itemId:id}}))throw new WmsError('固定或已引用项目不能删除。',409);await tx.financeAuxiliaryItem.delete({where:{id}});result={deletedId:id};}
       else{const name=requireText(body.name,'项目名称',120);if(typeof body.enabled!=='boolean')throw new WmsError('须明确项目启用状态。',400);if(item.isFixed&&name!==item.name)throw new WmsError('系统项目不能改名。',409);result={item:await tx.financeAuxiliaryItem.update({where:{id},data:{name,enabled:body.enabled,revision:{increment:1}}})};}
      }else if (action === 'create-type') result = { type: await tx.financeAuxiliaryType.create({ data: { ...data, code: requireText(body.code, '类型编码', 40), name: requireText(body.name, '类型名称', 120) } }) };
      else if (action === 'create-voucher-type') result = { voucherType: await tx.financeVoucherType.create({ data: { ...data, code: requireText(body.code, '类别编码', 40), name: requireText(body.name, '类别名称', 120), policyReference: requireText(body.policyReference, '目标端凭证类别依据', 1000) } }) };
      else {
        const typeId = requireText(body.typeId, '辅助类型 ID');
        if (!await tx.financeAuxiliaryType.findFirst({ where: { ...where, id: typeId } })) throw new WmsError('辅助类型不存在。', 404);
        if (action === 'create-item') result = { item: await tx.financeAuxiliaryItem.create({ data: { ...data, typeId, code: requireText(body.code, '项目编码', 50), name: requireText(body.name, '项目名称', 120),isFixed:body.isFixed===true } }) };
        else {
          const subjectId = requireText(body.subjectId, '科目 ID');
          if (typeof body.required !== 'boolean') throw new WmsError('须明确辅助核算是否必填。', 400);
          if (!await tx.financeSubject.findFirst({ where: { ...where, id: subjectId, leaf: true, enabled: true } })) throw new WmsError('科目须为当前账套启用末级科目。', 422);
          result = { rule: await tx.financeSubjectAuxiliary.create({ data: { ...data, typeId, subjectId, required: body.required, policyReference: requireText(body.policyReference, '目标端科目辅助依据', 1000) } }) };
        }
      }
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `finance.auxiliary.${action}`, entityType: action === 'annotate-voucher' ? 'FinanceVoucher' : 'FinanceBook', entityId: action === 'annotate-voucher' ? String(body.voucherId) : bookId, metadata: { workspaceId: scope.workspaceId, request: json(body), result: json(result) } } });
    return result;
  });
}

export async function assertIndependentAuxiliaryReview(tx: Tx, scope: WmsScope, voucherId: string) {
  if (await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, userId: scope.actorUserId, action: { in: ['finance.auxiliary.annotate-voucher', 'finance.attachment.upload'] }, entityType: 'FinanceVoucher', entityId: voucherId }, select: { id: true } })) throw new WmsError('辅助核算编辑人不能审核该凭证。', 403);
}
