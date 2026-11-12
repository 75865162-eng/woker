import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';
import type { Tx } from '@/lib/wms/repository';
import { amountUnits, itemAmount, itemKind, planSettlement, unitsAmount } from './open-item-rules';

function dateValue(value: unknown, label: string) {
  const date = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new WmsError(`${label}无效。`, 400);
  return date;
}
function amountText(value: Prisma.Decimal) { return value.toFixed(6); }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export async function queryFinanceOpenItems(scope: WmsScope, params: URLSearchParams) {
  const bookId = requireText(params.get('bookId'), '账套 ID');
  const asOf = dateValue(params.get('asOf') ?? new Date().toISOString().slice(0,10), '账龄日期');
  const where = { ...scoped(scope), bookId };
  return prisma.$transaction(async tx => {
  const items = await tx.financeOpenItem.findMany({ where, include: { voucher: { select: { sourceKey: true, date: true } }, documentSettlements: { where: { reversedAt: null }, select: { amount: true } }, paymentSettlements: { where: { reversedAt: null }, select: { amount: true } } }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 201 });
  const settlements = await tx.financeSettlement.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 101 });
  return { items: items.slice(0,200).map(({ documentSettlements, paymentSettlements, ...item }) => {
    const allocated = [...documentSettlements,...paymentSettlements].reduce((sum,row) => sum.plus(row.amount), new Prisma.Decimal(0));
    const remaining = item.status === 'VOIDED' ? new Prisma.Decimal(0) : item.amount.minus(allocated);
    return { ...item, amount: amountText(item.amount), allocated: amountText(allocated), remaining: amountText(remaining), overdueDays: remaining.gt(0) ? Math.max(0, Math.floor((Date.parse(asOf)-item.dueDate.getTime())/86400000)) : 0 };
  }), settlements: settlements.slice(0,100).map(row => ({ ...row, amount: amountText(row.amount) })), asOf, limits: { items: 200, settlements: 100 }, truncated: { items: items.length>200, settlements: settlements.length>100 }, scope: 'REGISTERED_POSTED_VOUCHER_ITEMS' };
  }, { isolationLevel: 'RepeatableRead' });
}

async function lockBook(tx: Tx, scope: WmsScope, bookId: string) {
  await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
  if (!await tx.financeBook.findFirst({ where: { ...scoped(scope), id: bookId, enabled: true } })) throw new WmsError('账套不存在或已停用。',404);
}

export async function createFinanceOpenItem(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'bookId', 'voucherId', 'subjectId', 'counterparty', 'kind', 'dueDate', 'evidence']);
  const bookId = requireText(body.bookId, '账套 ID'), voucherId = requireText(body.voucherId, '凭证 ID'), subjectId = requireText(body.subjectId, '科目 ID');
  const counterparty = requireText(body.counterparty, '往来对象', 160), evidence = requireText(body.evidence, '往来依据', 1000);
  const kind = itemKind(body.kind), dueDate = dateValue(body.dueDate, '到期日');
  return prisma.$transaction(async tx => {
    await lockBook(tx, scope, bookId);
    await tx.$queryRaw`SELECT id FROM "FinanceVoucher" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND "bookId"=${bookId} AND id=${voucherId} FOR UPDATE`;
    const voucher = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), id: voucherId, bookId, status: 'POSTED' }, include: { book: true, lines: { where: { subjectId } } } });
    const subject = await tx.financeSubject.findFirst({ where: { ...scoped(scope), bookId, id: subjectId, enabled: true, leaf: true } });
    if (!voucher || !subject) throw new WmsError('往来项必须来自当前工作区已过账凭证的启用末级科目。', 409);
    if (!voucher.lines.length) throw new WmsError('凭证没有该科目的分录。', 422);
    const amount = itemAmount(kind, voucher.lines.map(line => ({ debit: amountText(line.debit), credit: amountText(line.credit) })));
    const existing = await tx.financeOpenItem.findFirst({ where: { ...scoped(scope), voucherId, subjectId } });
    if (existing) {
      if (existing.createdBy!==scope.actorUserId || existing.counterparty!==counterparty || existing.kind!==kind || existing.dueDate.toISOString().slice(0,10)!==dueDate || existing.evidence!==evidence) throw new WmsError('该凭证科目已登记其他往来项。',409);
      return { item: { ...existing, amount: amountText(existing.amount) }, reused: true };
    }
    if (voucher.kind!=='STANDARD' || await tx.financeVoucher.count({where:{...scoped(scope),reversalOf:voucherId}})) throw new WmsError('已存在冲销或非普通凭证，不能登记。',409);
    const period = await tx.financePeriod.findFirst({where:{...scoped(scope),bookId,id:voucher.periodId}});
    if(!period || period.status!=='OPEN') throw new WmsError('不能在关闭期间登记新的往来项。',409);
    const item = await tx.financeOpenItem.create({ data: { id: crypto.randomUUID(), ...scoped(scope), bookId, voucherId, subjectId, counterparty, kind, currency: voucher.book.currency, amount: new Prisma.Decimal(amount), dueDate: new Date(`${dueDate}T00:00:00Z`), evidence, createdBy: scope.actorUserId } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.open-item.create', entityType: 'FinanceOpenItem', entityId: item.id, metadata: { workspaceId: scope.workspaceId, bookId, voucherId, subjectId, kind, amount, currency: voucher.book.currency } } });
    return { item: { ...item, amount: amountText(item.amount) }, reused: false };
  });
}

export async function settleFinanceOpenItems(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['action', 'bookId', 'documentId', 'paymentId', 'documentRevision', 'paymentRevision', 'periodId', 'date', 'amount', 'idempotencyKey', 'evidence']);
  const documentId = requireText(body.documentId, '往来单据 ID'), paymentId = requireText(body.paymentId, '付款或收款 ID');
  const periodId = requireText(body.periodId, '核销期间 ID'), date = dateValue(body.date, '核销日期');
  const amount = requireText(body.amount, '核销金额'), idempotencyKey = requireText(body.idempotencyKey, '幂等键'), evidence = requireText(body.evidence, '核销依据', 1000);
  const documentRevision=requireRevision(body.documentRevision), paymentRevision=requireRevision(body.paymentRevision), requestedBookId=requireText(body.bookId,'账套 ID');
  const normalized = amountUnits(amount);
  if (normalized <= BigInt(0)) throw new WmsError('核销金额须大于零。', 400);
  const requestHash = hash({ documentId, paymentId, documentRevision, paymentRevision, periodId, date, amount: unitsAmount(normalized), evidence });
  return prisma.$transaction(async tx => {
    const [documentIdentity, paymentIdentity] = await Promise.all([
      tx.financeOpenItem.findFirst({ where: { ...scoped(scope), id: documentId }, select: { bookId: true } }),
      tx.financeOpenItem.findFirst({ where: { ...scoped(scope), id: paymentId }, select: { bookId: true } }),
    ]);
    if (!documentIdentity || !paymentIdentity || documentIdentity.bookId !== paymentIdentity.bookId) throw new WmsError('核销对象不存在或不属于同一账套。', 404);
    const bookId = documentIdentity.bookId;
    if (bookId!==requestedBookId) throw new WmsError('核销账套不匹配。',409);
    await lockBook(tx,scope,bookId);
    const prior = await tx.financeSettlement.findFirst({ where: { ...scoped(scope), bookId, idempotencyKey } });
    if (prior) {
      if (prior.createdBy === scope.actorUserId && prior.requestHash === requestHash) return { settlement: { ...prior, amount: amountText(prior.amount) }, reused: true };
      throw new WmsError('核销幂等键已用于其他请求。', 409);
    }

    await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FinanceOpenItem" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id IN (${documentId}, ${paymentId}) ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodId} FOR UPDATE`;
    const [document, payment, period, settlements] = await Promise.all([
      tx.financeOpenItem.findFirst({ where: { ...scoped(scope), id: documentId, bookId } }),
      tx.financeOpenItem.findFirst({ where: { ...scoped(scope), id: paymentId, bookId } }),
      tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId, bookId } }),
      tx.financeSettlement.findMany({ where: { ...scoped(scope), bookId, reversedAt: null, OR: [{ documentId }, { paymentId }] } }),
    ]);
    if (!document || !payment || !period || period.status !== 'OPEN' || date < period.start.toISOString().slice(0, 10) || date > period.end.toISOString().slice(0, 10)) throw new WmsError('核销须位于当前账套的开放会计期间。', 409);
    if(document.revision!==documentRevision || payment.revision!==paymentRevision) throw new WmsError('往来项版本已变化。',409);
    const sourceVouchers = await tx.financeVoucher.findMany({where:{...scoped(scope),bookId,id:{in:[document.voucherId,payment.voucherId]}},select:{date:true,reversals:{select:{id:true}}}});
    if(sourceVouchers.length!==2 || sourceVouchers.some(row=>row.date.toISOString().slice(0,10)>date || row.reversals.length)) throw new WmsError('来源日期晚于核销日期或存在冲销。',409);
    const used = new Map<string, bigint>();
    for (const row of settlements) {
      const units = amountUnits(amountText(row.amount));
      used.set(row.documentId, (used.get(row.documentId) ?? BigInt(0)) + units);
      used.set(row.paymentId, (used.get(row.paymentId) ?? BigInt(0)) + units);
    }
    const leftAllocated = (id: string) => unitsAmount(used.get(id) ?? BigInt(0));
    const docPlan = { ...document, amount: amountText(document.amount), allocated: leftAllocated(document.id) };
    const paymentPlan = { ...payment, amount: amountText(payment.amount), allocated: leftAllocated(payment.id) };
    planSettlement(docPlan, paymentPlan, unitsAmount(normalized));
    const settlement = await tx.financeSettlement.create({ data: { id: crypto.randomUUID(), ...scoped(scope), bookId, documentId, paymentId, periodId, date: new Date(`${date}T00:00:00Z`), amount: new Prisma.Decimal(unitsAmount(normalized)), idempotencyKey, requestHash, evidence, createdBy: scope.actorUserId } });
    await tx.financeOpenItem.updateMany({where:{...scoped(scope),bookId,id:{in:[documentId,paymentId]}},data:{revision:{increment:1}}});
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.open-item.settle', entityType: 'FinanceSettlement', entityId: settlement.id, metadata: { workspaceId: scope.workspaceId, bookId, documentId, paymentId, periodId, date, amount: unitsAmount(normalized) } } });
    return { settlement: { ...settlement, amount: amountText(settlement.amount) }, reused: false };
  });
}

export async function mutateFinanceOpenItems(scope: WmsScope, body: Record<string, unknown>) {
  if(body.action==='register') {
    const voucherId=requireText(body.voucherId,'凭证 ID');
    const voucher=await prisma.financeVoucher.findFirst({where:{...scoped(scope),id:voucherId},select:{bookId:true}});
    if(!voucher) throw new WmsError('凭证不存在。',404);
    return createFinanceOpenItem(scope,{...body,bookId:voucher.bookId});
  }
  if(body.action==='settle') return settleFinanceOpenItems(scope,body);
  if(body.action!=='reverse-settlement') throw new WmsError('往来操作无效。',400);
  strictKeys(body,['action','bookId','settlementId','evidence']);
  const bookId=requireText(body.bookId,'账套 ID'),settlementId=requireText(body.settlementId,'核销 ID'),evidence=requireText(body.evidence,'撤销依据',2000);
  return prisma.$transaction(async tx=>{
    await lockBook(tx,scope,bookId);
    const row=await tx.financeSettlement.findFirst({where:{...scoped(scope),bookId,id:settlementId}});
    if(!row)throw new WmsError('核销不存在。',404);
    if(row.reversedAt){
      if(row.reversedBy!==scope.actorUserId || row.reversalEvidence!==evidence) throw new WmsError('撤销依据不能覆盖。',409);
      return {settlement:{...row,amount:amountText(row.amount)},reused:true};
    }
    const period=await tx.financePeriod.findFirst({where:{...scoped(scope),bookId,id:row.periodId}});
    if(!period || period.status!=='OPEN')throw new WmsError('核销期间已关闭，不能撤销。',409);
    const updated=await tx.financeSettlement.update({where:{id:settlementId},data:{reversedAt:new Date(),reversedBy:scope.actorUserId,reversalEvidence:evidence}});
    await tx.financeOpenItem.updateMany({where:{...scoped(scope),bookId,id:{in:[row.documentId,row.paymentId]}},data:{revision:{increment:1}}});
    await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'finance.open-item.reverse-settlement',entityType:'FinanceSettlement',entityId:settlementId,metadata:{workspaceId:scope.workspaceId,evidence}}});
    return {settlement:{...updated,amount:amountText(updated.amount)},reused:false};
  });
}
export async function guardOpenItemReversal(tx: Tx, scope: WmsScope, voucherId: string, voidItems: boolean) {
  const items=await tx.financeOpenItem.findMany({where:{...scoped(scope),voucherId,status:'OPEN'}});
  const ids=items.map(row=>row.id);
  if(ids.length && await tx.financeSettlement.count({where:{...scoped(scope),reversedAt:null,OR:[{documentId:{in:ids}},{paymentId:{in:ids}}]}}))throw new WmsError('原凭证有有效核销，须先撤销核销后冲销。',409);
  if(voidItems && ids.length)await tx.financeOpenItem.updateMany({where:{...scoped(scope),voucherId,status:'OPEN'},data:{status:'VOIDED',revision:{increment:1}}});
}
