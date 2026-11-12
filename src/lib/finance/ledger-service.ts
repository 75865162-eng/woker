import {assertFinanceAction} from './access';
import { validateVoucherAuxiliary, copyVoucherAuxiliary, assertIndependentAuxiliaryReview, assertReviewedVoucherAuxiliary } from './auxiliary-service';
import { requireBusinessCloseReview } from './close-service';
import { parseClosePolicy } from './close-rules';
import { guardOpenItemReversal } from './open-item-service';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { Tx } from '@/lib/wms/repository';
import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';
import { planRegisteredLedgerClose, planPeriodReopen, planVoucherPosting, reversalDraft, reviewVoucher, trialBalance, validateVoucher, type AccountingPeriod, type AccountingSubject, type OpeningBalance, type Voucher } from './rules';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WmsError('请求对象无效。', 400);
  return value as Record<string, unknown>;
}
function dateText(value: unknown, label: string) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) throw new WmsError(`${label}日期无效。`, 400);
  return text;
}
function decimalText(value: unknown, label: string, allowZero = true) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?$/.test(value.trim())) throw new WmsError(`${label}须为最多六位小数的非负十进制字符串。`, 400);
  const parsed = new Prisma.Decimal(value);
  if (!allowZero && parsed.isZero()) throw new WmsError(`${label}须大于零。`, 400);
  return parsed;
}
function currency(value: unknown) {
  const result = requireText(value, '账套本位币');
  if (!/^[A-Z]{3}$/.test(result)) throw new WmsError('账套本位币须为三位大写代码。', 400);
  return result;
}
function financeScope(scope: WmsScope, book: { id: string; currency: string }) {
  return { organizationId: scope.organizationId, workspaceId: scope.workspaceId, bookId: book.id, currency: book.currency };
}
function asPeriod(row: { id: string; organizationId: string; workspaceId: string; bookId: string; start: Date; end: Date; status: string }, currencyCode: string): AccountingPeriod {
  return { organizationId: row.organizationId, workspaceId: row.workspaceId, bookId: row.bookId, currency: currencyCode, id: row.id, start: row.start.toISOString().slice(0, 10), end: row.end.toISOString().slice(0, 10), status: row.status as AccountingPeriod['status'] };
}
function asSubjects(rows: Array<{ id: string; organizationId: string; workspaceId: string; bookId: string; enabled: boolean; leaf: boolean; normalSide: string }>, currencyCode: string): AccountingSubject[] {
  return rows.map(row => ({ organizationId: row.organizationId, workspaceId: row.workspaceId, bookId: row.bookId, currency: currencyCode, id: row.id, enabled: row.enabled, leaf: row.leaf, normalSide: row.normalSide as 'DEBIT' | 'CREDIT' }));
}
function asVoucher(row: { id: string; organizationId: string; workspaceId: string; bookId: string; periodId: string; sourceKey: string; date: Date; status: string; kind: string; reversalOf: string | null; lines: Array<{ subjectId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }> }, currencyCode: string): Voucher {
  return { organizationId: row.organizationId, workspaceId: row.workspaceId, bookId: row.bookId, currency: currencyCode, id: row.id, sourceKey: row.sourceKey, periodId: row.periodId, date: row.date.toISOString().slice(0, 10), status: row.status as Voucher['status'], kind: row.kind as Voucher['kind'], reversalOf: row.reversalOf, lines: row.lines.map(line => ({ accountId: line.subjectId, debit: line.debit.toFixed(6), credit: line.credit.toFixed(6) })) };
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export async function queryFinanceLedger(scope: WmsScope, params: URLSearchParams) {
  return prisma.$transaction(async tx=>{
  await assertFinanceAction(tx,scope,'view');
  const bookId = params.get('bookId')?.trim() ?? '';
  const [books, periods, subjects, vouchers] = await Promise.all([
    tx.financeBook.findMany({ where: scoped(scope), orderBy: [{ code: 'asc' }, { id: 'asc' }] }),
    tx.financePeriod.findMany({ where: { ...scoped(scope), ...(bookId ? { bookId } : {}) }, orderBy: [{ start: 'desc' }, { id: 'desc' }], take: 120 }),
    tx.financeSubject.findMany({ where: { ...scoped(scope), ...(bookId ? { bookId } : {}) }, orderBy: [{ code: 'asc' }, { id: 'asc' }], take: 1000 }),
    tx.financeVoucher.findMany({ where: { ...scoped(scope), ...(bookId ? { bookId } : {}) }, include: { lines: { orderBy: { lineNumber: 'asc' } }, period: { select: { start: true, end: true, status: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
  ]);
  const trial = params.get('periodId') && bookId ? await readTrialInTransaction(tx,scope,bookId,params.get('periodId')!) : null;
  return { books, periods, subjects, vouchers: vouchers.map(row => ({ ...row, lines: row.lines.map(line => ({ ...line, debit: line.debit.toFixed(6), credit: line.credit.toFixed(6) })) })), trial, limits: { periods: 120, subjects: 1000, vouchers: 100 } };
  });
}

export async function readTrialInTransaction(tx: Tx, scope: WmsScope, bookId: string, periodId: string) {
  const periodRow = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId, bookId, book: { enabled: true } }, include: { book: true } });
  if (!periodRow) throw new WmsError('会计期间不存在或不属于当前账套。', 404);
  const [subjectRows, openingRows, voucherRows] = await Promise.all([
    tx.financeSubject.findMany({ where: { ...scoped(scope), bookId } }),
    tx.financeOpeningBalance.findMany({ where: { ...scoped(scope), bookId, periodId } }),
    tx.financeVoucher.findMany({ where: { ...scoped(scope), bookId, periodId, status: 'POSTED' }, include: { lines: { orderBy: { lineNumber: 'asc' } } } }),
  ]);
  const scopeValue = financeScope(scope, periodRow.book);
  const period = asPeriod(periodRow, periodRow.book.currency);
  const subjects = asSubjects(subjectRows, periodRow.book.currency);
  const opening: OpeningBalance[] = openingRows.map(row => ({ ...scopeValue, accountId: row.subjectId, amount: row.amount.toFixed(6), side: row.side as OpeningBalance['side'] }));
  const vouchers = voucherRows.map(row => asVoucher(row, periodRow.book.currency));
  return trialBalance(period, subjects, opening, vouchers);
}

export async function mutateFinanceLedger(scope: WmsScope, body: Record<string, unknown>) {
  const action = requireText(body.action, '总账操作');
  if (action === 'create-book') {
    strictKeys(body, ['action', 'code', 'name', 'currency']);
    const code = requireText(body.code, '账套编码', 40), name = requireText(body.name, '账套名称', 120), currencyCode = currency(body.currency);
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      const book = await tx.financeBook.create({ data: { id: crypto.randomUUID(), ...scoped(scope), code, name, currency: currencyCode, createdBy: scope.actorUserId } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.book.create', entityType: 'FinanceBook', entityId: book.id, metadata: { workspaceId: scope.workspaceId, code, currency: currencyCode } } });
      return { book };
    });
  }
  if (action === 'create-period' || action === 'open-period') {
    strictKeys(body, action === 'create-period' ? ['action', 'bookId', 'code', 'start', 'end'] : ['action', 'periodId', 'revision']);
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      if (action === 'create-period') {
        const bookId = requireText(body.bookId, '账套 ID'), code = requireText(body.code, '期间编码', 40), start = dateText(body.start, '期间开始'), end = dateText(body.end, '期间结束');
        if (start > end) throw new WmsError('期间起止日期无效。', 400);
        await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} AND enabled=true FOR UPDATE`;
        const book = await tx.financeBook.findFirst({ where: { ...scoped(scope), id: bookId, enabled: true } });
        if (!book) throw new WmsError('账套不存在或已停用。', 404);
        if (await tx.financePeriod.findFirst({ where: { ...scoped(scope), bookId, start: { lte: new Date(`${end}T00:00:00Z`) }, end: { gte: new Date(`${start}T00:00:00Z`) } } })) throw new WmsError('会计期间日期不能与现有期间重叠。', 409);
        const period = await tx.financePeriod.create({ data: { id: crypto.randomUUID(), ...scoped(scope), bookId, code, start: new Date(`${start}T00:00:00Z`), end: new Date(`${end}T00:00:00Z`) } });
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.period.create', entityType: 'FinancePeriod', entityId: period.id, metadata: { workspaceId: scope.workspaceId, bookId, code, start, end } } });
        return { period };
      }
      const periodId = requireText(body.periodId, '期间 ID'), revision = requireRevision(body.revision);
      const period = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId, book: { enabled: true } }, include: { book: true } });
      if (!period) throw new WmsError('会计期间不存在。', 404);
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${period.bookId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodId} FOR UPDATE`;
      if (period.revision !== revision || period.status !== 'NOT_OPEN') throw new WmsError('仅当前版本的未开放期间可开启。', 409);
      const opened = await tx.financePeriod.update({ where: { id: periodId }, data: { status: 'OPEN', revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.period.open', entityType: 'FinancePeriod', entityId: periodId, metadata: { workspaceId: scope.workspaceId, revision: opened.revision } } });
      return { period: opened };
    });
  }
  if (action === 'create-subject') {
    strictKeys(body, ['action', 'bookId', 'parentId', 'code', 'name', 'normalSide']);
    const bookId = requireText(body.bookId, '账套 ID'), code = requireText(body.code, '科目编码', 40), name = requireText(body.name, '科目名称', 120);
    if (!['DEBIT', 'CREDIT'].includes(String(body.normalSide))) throw new WmsError('科目余额方向无效。', 400);
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} AND enabled=true FOR UPDATE`;
      if (!await tx.financeBook.findFirst({ where: { ...scoped(scope), id: bookId, enabled: true } })) throw new WmsError('账套不存在或已停用。', 404);
      const parentId = body.parentId == null || body.parentId === '' ? null : requireText(body.parentId, '上级科目 ID');
      if (parentId) {
        const parent = await tx.financeSubject.findFirst({ where: { ...scoped(scope), bookId, id: parentId, enabled: true } });
        if (!parent || !parent.leaf) throw new WmsError('上级科目不存在、已停用或不能继续挂接子科目。', 409);
        await tx.financeSubject.update({ where: { id: parent.id }, data: { leaf: false, revision: { increment: 1 } } });
      }
      const subject = await tx.financeSubject.create({ data: { id: crypto.randomUUID(), ...scoped(scope), bookId, parentId, code, name, normalSide: body.normalSide as string, leaf: true } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.subject.create', entityType: 'FinanceSubject', entityId: subject.id, metadata: { workspaceId: scope.workspaceId, bookId, code, parentId } } });
      return { subject };
    });
  }
  if (action === 'save-opening') {
    strictKeys(body, ['action', 'periodId', 'revision', 'subjectId', 'amount', 'side']);
    const periodId = requireText(body.periodId, '期间 ID'), revision = requireRevision(body.revision), subjectId = requireText(body.subjectId, '科目 ID');
    const amount = decimalText(body.amount, '期初金额');
    if (!['DEBIT', 'CREDIT'].includes(String(body.side))) throw new WmsError('期初余额方向无效。', 400);
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      const identity = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId }, select: { bookId: true } });
      if (!identity) throw new WmsError('会计期间不存在。', 404);
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.bookId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodId} FOR UPDATE`;
      const period = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId } });
      if (!period || period.revision !== revision || !['NOT_OPEN', 'OPEN'].includes(period.status)) throw new WmsError('期初只能在当前版本未结账期间维护。', 409);
      if (await tx.financeVoucher.count({ where: { ...scoped(scope), bookId: period.bookId, periodId, status: 'POSTED' } })) throw new WmsError('已有凭证过账，期初余额不可再修改。', 409);
      const subject = await tx.financeSubject.findFirst({ where: { ...scoped(scope), bookId: period.bookId, id: subjectId, enabled: true, leaf: true } });
      if (!subject) throw new WmsError('期初余额必须使用当前启用的末级科目。', 400);
      const opening = await tx.financeOpeningBalance.upsert({ where: { organizationId_workspaceId_periodId_subjectId: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, periodId, subjectId } }, create: { id: crypto.randomUUID(), ...scoped(scope), bookId: period.bookId, periodId, subjectId, amount, side: body.side as string, createdBy: scope.actorUserId }, update: { amount, side: body.side as string, revision: { increment: 1 }, createdBy: scope.actorUserId } });
      const updated = await tx.financePeriod.update({ where: { id: periodId }, data: { revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.opening.save', entityType: 'FinanceOpeningBalance', entityId: opening.id, metadata: { workspaceId: scope.workspaceId, bookId: period.bookId, periodId, subjectId, revision: updated.revision } } });
      return { opening, revision: updated.revision };
    });
  }
  if (action === 'create-voucher') {
    strictKeys(body, ['action', 'periodId', 'idempotencyKey', 'sourceKey', 'date', 'memo', 'lines']);
    const periodId = requireText(body.periodId, '期间 ID'), idempotencyKey = requireText(body.idempotencyKey, '幂等键'), sourceKey = requireText(body.sourceKey, '凭证来源标识');
    if (/^(?:FBA-ADJUSTMENT|WMS-COMMAND|WMS-COST-ADJUSTMENT|WMS-INVENTORY-RISK|WMS-OVERSEAS-CHARGE|TEMPLATE-SOURCE|PURCHASE-PAYMENT|PURCHASE-REFUND|PROFIT-LOSS|VOUCHER-IMPORT|EXTERNAL-FINANCE|FX-REVALUATION):/.test(sourceKey)) throw new WmsError('该来源标识仅允许经核算来源交接创建。', 400);
    const date = dateText(body.date, '会计日期'), memo = typeof body.memo === 'string' ? body.memo.trim().slice(0, 500) : '';
    if (!Array.isArray(body.lines) || body.lines.length < 2 || body.lines.length > 200) throw new WmsError('凭证须有 2 至 200 条分录。', 400);
    const lines = body.lines.map((raw, index) => { const line = record(raw); strictKeys(line, ['subjectId', 'debit', 'credit', 'memo']); return { subjectId: requireText(line.subjectId, `第 ${index + 1} 行科目`), debit: decimalText(line.debit, `第 ${index + 1} 行借方`), credit: decimalText(line.credit, `第 ${index + 1} 行贷方`), memo: typeof line.memo === 'string' ? line.memo.trim().slice(0, 240) : '' }; });
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      return createLedgerVoucher(tx, scope, { periodId, idempotencyKey, sourceKey, date, memo, lines });
    });
  }
  if (action === 'review-voucher' || action === 'post-voucher') {
    strictKeys(body, ['action', 'voucherId', 'revision']);
    const voucherId = requireText(body.voucherId, '凭证 ID'), revision = requireRevision(body.revision);
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      const identity = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), id: voucherId }, select: { bookId: true, periodId: true } });
      if (!identity) throw new WmsError('凭证不存在。', 404);
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.bookId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.periodId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinanceVoucher" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${voucherId} FOR UPDATE`;
      const row = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), id: voucherId }, include: { book: true, period: true, lines: { orderBy: { lineNumber: 'asc' } } } });
      if (!row) throw new WmsError('凭证不存在。', 404);
      if (row.revision !== revision) throw new WmsError('凭证版本已变化。', 409);
      if (action === 'review-voucher') {
        await assertIndependentAuxiliaryReview(tx, scope, voucherId);
        const auxiliaryEvidence = await validateVoucherAuxiliary(tx, scope, voucherId, row.bookId, row.kind);
        if (row.createdBy === scope.actorUserId) throw new WmsError('凭证禁止申请人自审。', 403);
        const next = reviewVoucher(asVoucher(row, row.book.currency), asPeriod(row.period, row.book.currency), asSubjects(await tx.financeSubject.findMany({ where: { ...scoped(scope), bookId: row.bookId } }), row.book.currency));
        const updated = await tx.financeVoucher.update({ where: { id: voucherId }, data: { status: next.status, reviewedBy: scope.actorUserId, reviewedAt: new Date(), revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.voucher.review', entityType: 'FinanceVoucher', entityId: voucherId, metadata: { workspaceId: scope.workspaceId, revision: updated.revision, auxiliaryEvidence } } });
        return { voucher: updated };
      }
      if (row.status !== 'REVIEWED' || row.period.status !== 'OPEN') throw new WmsError('仅开放期间的已审核凭证可以过账。', 409);
      await assertReviewedVoucherAuxiliary(tx, scope, voucherId, row.bookId, revision);
      const subjects = asSubjects(await tx.financeSubject.findMany({ where: { ...scoped(scope), bookId: row.bookId } }), row.book.currency);
      const postedKeys = await tx.financeVoucher.findMany({ where: { ...scoped(scope), bookId: row.bookId, status: 'POSTED', id: { not: voucherId } }, select: { sourceKey: true } });
      const voucherValue = asVoucher(row, row.book.currency);
      let reversal: Parameters<typeof planVoucherPosting>[4];
      if (row.kind === 'REVERSAL' && row.reversalOf) {
        const originalRow = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), id: row.reversalOf }, include: { period: true, book: true, lines: { orderBy: { lineNumber: 'asc' } } } });
        if (!originalRow) throw new WmsError('冲销原凭证不存在。', 404);
        const reversals = await tx.financeVoucher.findMany({ where: { ...scoped(scope), reversalOf: originalRow.id, status: 'POSTED', id: { not: voucherId } }, select: { id: true } });
        reversal = { original: asVoucher(originalRow, row.book.currency), period: asPeriod(originalRow.period, row.book.currency), existingReversalIds: reversals.map(item => item.id) };
      }
      if (row.reversalOf) {
        const originalLines = await tx.financeVoucherLine.findMany({ where: { ...scoped(scope), voucherId: row.reversalOf }, select: { id: true } });
        if (await tx.financeBankMatchEntry.count({ where: { ...scoped(scope), bookId: row.bookId, active: true, voucherLineId: { in: originalLines.map(line=>line.id) } } })) throw new WmsError('原凭证存在有效银行对账，请先撤销对账。', 409);
        await guardOpenItemReversal(tx, scope, row.reversalOf, true);
      }
      planVoucherPosting(voucherValue, asPeriod(row.period, row.book.currency), subjects, postedKeys.map(item => item.sourceKey), reversal);
      const updated = await tx.financeVoucher.update({ where: { id: voucherId }, data: { status: 'POSTED', postedBy: scope.actorUserId, postedAt: new Date(), revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.voucher.post', entityType: 'FinanceVoucher', entityId: voucherId, metadata: { workspaceId: scope.workspaceId, bookId: row.bookId, periodId: row.periodId, sourceKey: row.sourceKey, revision: updated.revision } } });
      return { voucher: updated };
    });
  }
  if (action === 'reverse-voucher') {
    strictKeys(body, ['action', 'voucherId', 'periodId', 'idempotencyKey', 'sourceKey', 'date']);
    const voucherId = requireText(body.voucherId, '原凭证 ID'), periodId = requireText(body.periodId, '冲销期间 ID'), idempotencyKey = requireText(body.idempotencyKey, '幂等键'), sourceKey = requireText(body.sourceKey, '冲销来源标识'), date = dateText(body.date, '冲销日期');
    if (/^(?:FBA-ADJUSTMENT|WMS-COMMAND|WMS-COST-ADJUSTMENT|WMS-INVENTORY-RISK|WMS-OVERSEAS-CHARGE|TEMPLATE-SOURCE|PURCHASE-PAYMENT|PURCHASE-REFUND|PROFIT-LOSS|VOUCHER-IMPORT|EXTERNAL-FINANCE|FX-REVALUATION):/.test(sourceKey)) throw new WmsError('冲销来源标识不能占用核算来源命名空间。', 400);
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      const originalIdentity = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), id: voucherId }, select: { bookId: true, periodId: true } });
      if (!originalIdentity) throw new WmsError('原凭证不存在。', 404);
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${originalIdentity.bookId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinanceVoucher" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${voucherId} FOR UPDATE`;
      const [original, target] = await Promise.all([
        tx.financeVoucher.findFirst({ where: { ...scoped(scope), id: voucherId }, include: { book: true, period: true, lines: { orderBy: { lineNumber: 'asc' } } } }),
        tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId, bookId: originalIdentity.bookId }, include: { book: true } }),
      ]);
      if (!original || !target) throw new WmsError('原凭证或目标期间不存在。', 404);
      const existing = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), bookId: original.bookId, idempotencyKey } });
      if (existing) {
        if (existing.createdBy !== scope.actorUserId || existing.kind !== 'REVERSAL' || existing.reversalOf !== voucherId || existing.periodId !== periodId || existing.sourceKey !== sourceKey || existing.date.toISOString().slice(0, 10) !== date) throw new WmsError('冲销幂等键已用于其他请求。', 409);
        return { voucher: existing, reused: true };
      }
      if (await tx.financeBankMatchEntry.count({ where: { ...scoped(scope), bookId: original.bookId, active: true, voucherLineId: { in: original.lines.map(line=>line.id) } } })) throw new WmsError('原凭证存在有效银行对账，请先撤销对账。', 409);
      await guardOpenItemReversal(tx, scope, original.id, false);
      const subjects = asSubjects(await tx.financeSubject.findMany({ where: { ...scoped(scope), bookId: original.bookId } }), original.book.currency);
      const reversals = await tx.financeVoucher.findMany({ where: { ...scoped(scope), reversalOf: original.id }, select: { id: true } });
      const draft = reversalDraft(asVoucher(original, original.book.currency), asPeriod(original.period, original.book.currency), asPeriod(target, target.book.currency), subjects, { id: crypto.randomUUID(), sourceKey, date, existingReversalIds: reversals.map(item => item.id) });
      const hash = digest({ reversalOf: original.id, sourceKey, date, lines: draft.lines });
      const voucher = await tx.financeVoucher.create({ data: { id: draft.id, ...scoped(scope), bookId: original.bookId, periodId, sourceKey, idempotencyKey, requestHash: hash, date: new Date(`${date}T00:00:00Z`), memo: `冲销凭证 ${original.sourceKey}`, kind: 'REVERSAL', reversalOf: original.id, createdBy: scope.actorUserId, lines: { create: draft.lines.map((line, index) => ({ id: crypto.randomUUID(), subjectId: line.accountId, lineNumber: index + 1, debit: line.debit, credit: line.credit })) } }, include: { lines: true } });
      await copyVoucherAuxiliary(tx, scope, original.bookId, original.id, voucher.id);
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.voucher.reverse-draft', entityType: 'FinanceVoucher', entityId: voucher.id, metadata: { workspaceId: scope.workspaceId, originalVoucherId: original.id, sourceKey } } });
      return { voucher, reused: false };
    });
  }
  if (action === 'close-period' || action === 'close-business-period' || action === 'reopen-period') {
    strictKeys(body, action === 'close-business-period' ? ['action', 'periodId', 'revision', 'reviewId'] : ['action', 'periodId', 'revision']);
    const periodId = requireText(body.periodId, '期间 ID'), revision = requireRevision(body.revision);
    return prisma.$transaction(async tx => {
      await assertFinanceAction(tx,scope,['open-period','review-voucher','post-voucher','close-period','close-business-period','reopen-period'].includes(action)?'approve':'create');
      const identity = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId }, select: { bookId: true } });
      if (!identity) throw new WmsError('会计期间不存在。', 404);
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.bookId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodId} FOR UPDATE`;
      const periodRow = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId }, include: { book: true } });
      if (!periodRow || periodRow.revision !== revision) throw new WmsError('会计期间版本已变化。', 409);
      if (action === 'close-period' || action === 'close-business-period') {
        if (action === 'close-period' && periodRow.book.closePolicy !== null) throw new WmsError('账套已配置业务关账制度，须完成独立来源核对后关账。', 409);
        const businessEvidence = action === 'close-business-period' ? await requireBusinessCloseReview(tx, scope, periodRow, requireText(body.reviewId, '独立复核 ID'), periodRow.book.closePolicy) : null;
        const [subjects, openingRows, voucherRows, unposted] = await Promise.all([
          tx.financeSubject.findMany({ where: { ...scoped(scope), bookId: periodRow.bookId } }),
          tx.financeOpeningBalance.findMany({ where: { ...scoped(scope), bookId: periodRow.bookId, periodId } }),
          tx.financeVoucher.findMany({ where: { ...scoped(scope), bookId: periodRow.bookId, periodId, status: 'POSTED' }, include: { lines: { orderBy: { lineNumber: 'asc' } } } }),
          tx.financeVoucher.count({ where: { ...scoped(scope), bookId: periodRow.bookId, periodId, status: { not: 'POSTED' } } }),
        ]);
        const scopeValue = financeScope(scope, periodRow.book), accountingPeriod = asPeriod(periodRow, periodRow.book.currency), accountingSubjects = asSubjects(subjects, periodRow.book.currency);
        const opening: OpeningBalance[] = openingRows.map(row => ({ ...scopeValue, accountId: row.subjectId, amount: row.amount.toFixed(6), side: row.side as OpeningBalance['side'] }));
        const trial = trialBalance(accountingPeriod, accountingSubjects, opening, voucherRows.map(row => asVoucher(row, periodRow.book.currency)));
        const closeEvidence = planRegisteredLedgerClose(accountingPeriod, { unpostedVouchers: unposted, trial });
        const updated = await tx.financePeriod.update({ where: { id: periodId }, data: { status: 'CLOSED', closedAt: new Date(), revision: { increment: 1 } } });
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.period.close', entityType: 'FinancePeriod', entityId: periodId, metadata: { workspaceId: scope.workspaceId, bookId: periodRow.bookId, trial, coverage: businessEvidence?.coverage ?? closeEvidence.coverage, businessEvidence: businessEvidence ?? null, businessReconciliationVerified: false, revision: updated.revision } } });
        return { period: updated, trial, closeEvidence: { coverage: businessEvidence?.coverage ?? closeEvidence.coverage, businessEvidence, unpostedVouchers: unposted, businessReconciliationVerified: false } };
      }
      if (periodRow.book.closePolicy !== null && !parseClosePolicy(periodRow.book.closePolicy).allowReopen) throw new WmsError('目标端关账制度禁止反结账。', 409);
      const subsequent = await tx.financePeriod.findMany({ where: { ...scoped(scope), bookId: periodRow.bookId, start: { gt: periodRow.end } } });
      planPeriodReopen(asPeriod(periodRow, periodRow.book.currency), subsequent.map(row => asPeriod(row, periodRow.book.currency)));
      const updated = await tx.financePeriod.update({ where: { id: periodId }, data: { status: 'OPEN', closedAt: null, revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.period.reopen', entityType: 'FinancePeriod', entityId: periodId, metadata: { workspaceId: scope.workspaceId, bookId: periodRow.bookId, revision: updated.revision } } });
      return { period: updated };
    });
  }
  throw new WmsError('总账操作不受支持。', 400);
}

export async function createLedgerVoucher(tx: Tx, scope: WmsScope, input: {
  periodId: string; idempotencyKey: string; sourceKey: string; date: string; memo: string;
  lines: Array<{ subjectId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; memo: string }>;
}) {
  await assertFinanceAction(tx,scope,'create');
  const { periodId, idempotencyKey, sourceKey, date, memo, lines } = input;
  const hash = digest({ periodId, sourceKey, date, memo, lines: lines.map(line => ({ ...line, debit: line.debit.toFixed(6), credit: line.credit.toFixed(6) })) });
      const identity = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId }, select: { bookId: true } });
      if (!identity) throw new WmsError('会计期间不存在。', 404);
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.bookId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${periodId} FOR UPDATE`;
      const periodRow = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId, book: { enabled: true } }, include: { book: true } });
      if (!periodRow) throw new WmsError('会计期间不存在或账套已停用。', 404);
      const existing = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), bookId: periodRow.bookId, idempotencyKey } });
      if (existing) {
        if (existing.createdBy === scope.actorUserId && existing.requestHash === hash) return { voucher: existing, reused: true };
        throw new WmsError('凭证幂等键冲突。', 409);
      }
      if (periodRow.status !== 'OPEN') throw new WmsError('凭证只能创建在开放期间。', 409);
      const subjects = await tx.financeSubject.findMany({ where: { ...scoped(scope), bookId: periodRow.bookId } });
      const newVoucher: Voucher = { ...financeScope(scope, periodRow.book), id: crypto.randomUUID(), sourceKey, periodId, date, status: 'DRAFT', kind: 'STANDARD', reversalOf: null, lines: lines.map(line => ({ accountId: line.subjectId, debit: line.debit.toFixed(6), credit: line.credit.toFixed(6) })) };
      validateVoucher(newVoucher, asPeriod(periodRow, periodRow.book.currency), asSubjects(subjects, periodRow.book.currency));
      const voucher = await tx.financeVoucher.create({ data: { id: newVoucher.id, ...scoped(scope), bookId: periodRow.bookId, periodId, sourceKey, idempotencyKey, requestHash: hash, date: new Date(`${date}T00:00:00Z`), memo, createdBy: scope.actorUserId, lines: { create: lines.map((line, index) => ({ id: crypto.randomUUID(), subjectId: line.subjectId, lineNumber: index + 1, debit: line.debit, credit: line.credit, memo: line.memo })) } }, include: { lines: true } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.voucher.create', entityType: 'FinanceVoucher', entityId: voucher.id, metadata: { workspaceId: scope.workspaceId, bookId: periodRow.bookId, periodId, sourceKey, revision: voucher.revision } } });
      return { voucher, reused: false };
}
