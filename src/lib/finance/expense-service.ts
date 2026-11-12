import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { scoped } from '@/lib/wms/access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';
import { createLedgerVoucher } from './ledger-service';
import { nextExpenseState, validateExpenseDraft, type ExpenseState } from './expense-rules';

function expenseInput(body: Record<string, unknown>, action: 'create' | 'edit') {
  strictKeys(body, ['action', 'number', 'category', 'payee', 'description', 'expenseDate', 'amount', 'currency', 'bookId', 'periodId', 'debitSubjectId', 'creditSubjectId', ...(action === 'edit' ? ['expenseId', 'revision'] : [])]);
  const field = (name: string, label: string, max: number) => {
    const value = body[name];
    if (typeof value !== 'string' || value.length > max) throw new WmsError(`${label}无效。`, 400);
    return value.trim();
  };
  const amount = body.amount;
  if (typeof amount !== 'string') throw new WmsError('金额格式无效。', 400);
  let values;
  try {
    values = validateExpenseDraft({
      number: field('number', '费用单号', 80), category: field('category', '费用类别', 80),
      payee: field('payee', '收款对象', 160), description: field('description', '费用说明', 500),
      expenseDate: field('expenseDate', '费用日期', 10), amount: amount.trim(),
      currency: field('currency', '币种', 3), debitSubjectId: field('debitSubjectId', '借方科目', 100),
      creditSubjectId: field('creditSubjectId', '贷方科目', 100),
    });
  } catch (error) { throw new WmsError(error instanceof Error ? error.message : '费用字段无效。', 400); }
  return { ...values, bookId: field('bookId', '账套 ID', 100), periodId: field('periodId', '期间 ID', 100) };
}

export async function queryFinanceExpenses(scope: WmsScope) {
  const [books, periods, subjects, expenses] = await Promise.all([
    prisma.financeBook.findMany({ where: { ...scoped(scope), enabled: true }, orderBy: { code: 'asc' } }),
    prisma.financePeriod.findMany({ where: scoped(scope), orderBy: { start: 'desc' }, take: 120 }),
    prisma.financeSubject.findMany({ where: scoped(scope), orderBy: [{ bookId: 'asc' }, { code: 'asc' }], take: 1000 }),
    prisma.financeExpense.findMany({ where: scoped(scope), include: { voucher: { select: { id: true, status: true, sourceKey: true } } }, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 200 }),
  ]);
  return { books, periods, subjects, expenses: expenses.map(expense => ({ ...expense, amount: expense.amount.toFixed(6) })), limits: { expenses: 200, periods: 120, subjects: 1000 } };
}

export async function createFinanceExpense(scope: WmsScope, body: Record<string, unknown>) {
  const input = expenseInput(body, 'create');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${input.bookId} FOR UPDATE`;
    const [book, period, debit, credit] = await Promise.all([
      tx.financeBook.findFirst({ where: { ...scoped(scope), id: input.bookId, enabled: true } }),
      tx.financePeriod.findFirst({ where: { ...scoped(scope), id: input.periodId, bookId: input.bookId } }),
      tx.financeSubject.findFirst({ where: { ...scoped(scope), id: input.debitSubjectId, bookId: input.bookId, enabled: true, leaf: true } }),
      tx.financeSubject.findFirst({ where: { ...scoped(scope), id: input.creditSubjectId, bookId: input.bookId, enabled: true, leaf: true } }),
    ]);
    if (!book || !period || period.status !== 'OPEN' || input.expenseDate < period.start.toISOString().slice(0, 10) || input.expenseDate > period.end.toISOString().slice(0, 10)) throw new WmsError('费用须关联当前工作区内的开放期间及账套。', 409);
    if (input.currency !== book.currency) throw new WmsError('费用币种必须与账套本位币一致；换汇须先录入有来源的汇率证据。', 400);
    if (!debit || !credit || debit.id === credit.id || debit.normalSide !== 'DEBIT' || credit.normalSide !== 'CREDIT') throw new WmsError('请选择启用的末级借方费用科目和贷方负债/资金科目。', 400);
    const expense = await tx.financeExpense.create({ data: {
      id: crypto.randomUUID(), ...scoped(scope), number: input.number, category: input.category,
      payee: input.payee, description: input.description, expenseDate: new Date(`${input.expenseDate}T00:00:00Z`),
      amount: new Prisma.Decimal(input.amount), currency: input.currency, bookId: input.bookId, periodId: input.periodId,
      debitSubjectId: debit.id, creditSubjectId: credit.id, createdBy: scope.actorUserId,
    } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.expense.create', entityType: 'FinanceExpense', entityId: expense.id, metadata: { workspaceId: scope.workspaceId, number: expense.number, currency: expense.currency } } });
    return { expense: { ...expense, amount: expense.amount.toFixed(6) } };
  });
}

export async function mutateFinanceExpense(scope: WmsScope, body: Record<string, unknown>) {
  const action = requireText(body.action, '费用操作') as 'edit' | 'submit' | 'approve' | 'reject';
  if (!['edit', 'submit', 'approve', 'reject'].includes(action)) throw new WmsError('费用操作不受支持。', 400);
  if (action === 'edit') {
    const input = expenseInput(body, 'edit');
    const expenseId = requireText(body.expenseId, '费用单 ID'), revision = requireRevision(body.revision);
    return prisma.$transaction(async tx => {
      const current = await tx.financeExpense.findFirst({ where: { ...scoped(scope), id: expenseId }, select: { bookId: true, periodId: true } });
      if (!current) throw new WmsError('费用单不存在。', 404);
      await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id IN (${current.bookId}, ${input.bookId}) ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id IN (${current.periodId}, ${input.periodId}) ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "FinanceExpense" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${expenseId} FOR UPDATE`;
      const expense = await tx.financeExpense.findFirst({ where: { ...scoped(scope), id: expenseId } });
      if (!expense) throw new WmsError('费用单不存在。', 404);
      if (expense.createdBy !== scope.actorUserId) throw new WmsError('仅申请人可修改费用草稿。', 403);
      if (expense.status !== 'DRAFT' || expense.revision !== revision) throw new WmsError('仅当前版本的费用草稿可修改。', 409);
      const [book, period, debit, credit] = await Promise.all([
        tx.financeBook.findFirst({ where: { ...scoped(scope), id: input.bookId, enabled: true } }),
        tx.financePeriod.findFirst({ where: { ...scoped(scope), id: input.periodId, bookId: input.bookId } }),
        tx.financeSubject.findFirst({ where: { ...scoped(scope), id: input.debitSubjectId, bookId: input.bookId, enabled: true, leaf: true } }),
        tx.financeSubject.findFirst({ where: { ...scoped(scope), id: input.creditSubjectId, bookId: input.bookId, enabled: true, leaf: true } }),
      ]);
      if (!book || !period || period.status !== 'OPEN' || input.expenseDate < period.start.toISOString().slice(0, 10) || input.expenseDate > period.end.toISOString().slice(0, 10)) throw new WmsError('费用须关联当前工作区内的开放期间及账套。', 409);
      if (input.currency !== book.currency) throw new WmsError('费用币种必须与账套本位币一致。', 400);
      if (!debit || !credit || debit.id === credit.id || debit.normalSide !== 'DEBIT' || credit.normalSide !== 'CREDIT') throw new WmsError('请选择启用的末级借方费用科目和贷方应付/资金科目。', 400);
      const updated = await tx.financeExpense.update({ where: { id: expenseId }, data: {
        number: input.number, category: input.category, payee: input.payee, description: input.description,
        expenseDate: new Date(`${input.expenseDate}T00:00:00Z`), amount: new Prisma.Decimal(input.amount), currency: input.currency,
        bookId: input.bookId, periodId: input.periodId, debitSubjectId: debit.id, creditSubjectId: credit.id, revision: { increment: 1 },
      } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.expense.edit-draft', entityType: 'FinanceExpense', entityId: expenseId, metadata: { workspaceId: scope.workspaceId, revision: updated.revision } } });
      return { expense: { ...updated, amount: updated.amount.toFixed(6) } };
    });
  }
  strictKeys(body, action === 'submit' ? ['action', 'expenseId', 'revision'] : ['action', 'expenseId', 'revision', 'decisionMemo']);
  const expenseId = requireText(body.expenseId, '费用单 ID'), revision = requireRevision(body.revision);
  const decisionMemo = typeof body.decisionMemo === 'string' ? body.decisionMemo.trim().slice(0, 500) : '';
  if (action === 'reject' && !decisionMemo) throw new WmsError('驳回时必须填写原因。', 400);
  return prisma.$transaction(async tx => {
    const identity = await tx.financeExpense.findFirst({ where: { ...scoped(scope), id: expenseId }, select: { bookId: true, periodId: true } });
    if (!identity) throw new WmsError('费用单不存在。', 404);
    await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.bookId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FinancePeriod" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${identity.periodId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FinanceExpense" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${expenseId} FOR UPDATE`;
    const current = await tx.financeExpense.findFirst({ where: { ...scoped(scope), id: expenseId }, include: { book: true, period: true } });
    if (!current) throw new WmsError('费用单不存在。', 404);
    if (current.revision !== revision) throw new WmsError('费用单版本已变化，请刷新后重试。', 409);
    let next: ExpenseState;
    try { next = nextExpenseState(current.status as ExpenseState, action.toUpperCase() as 'SUBMIT' | 'APPROVE' | 'REJECT'); }
    catch (error) { throw new WmsError(error instanceof Error ? error.message : '费用状态已变化。', 409); }
    if (action === 'submit') {
      if (current.createdBy !== scope.actorUserId) throw new WmsError('仅申请人可提交此费用单。', 403);
      if (current.period.status !== 'OPEN') throw new WmsError('会计期间已关闭，不能提交费用。', 409);
    } else {
      if (current.createdBy === scope.actorUserId) throw new WmsError('费用单禁止申请人自审。', 403);
      if (current.period.status !== 'OPEN') throw new WmsError('会计期间已关闭，不能审核费用。', 409);
    }
    let financeVoucherId: string | null = null;
    if (action === 'approve') {
      const amount = current.amount.toFixed(6);
      const result = await createLedgerVoucher(tx, scope, {
        periodId: current.periodId, idempotencyKey: `finance-expense:${current.id}`,
        sourceKey: `ERP-EXPENSE:${current.number}`, date: current.expenseDate.toISOString().slice(0, 10),
        memo: `${current.category} · ${current.payee} · ${current.description}`.slice(0, 500),
        lines: [
          { subjectId: current.debitSubjectId, debit: new Prisma.Decimal(amount), credit: new Prisma.Decimal(0), memo: current.description.slice(0, 240) },
          { subjectId: current.creditSubjectId, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(amount), memo: current.description.slice(0, 240) },
        ],
      });
      financeVoucherId = result.voucher.id;
    }
    const updated = await tx.financeExpense.update({ where: { id: expenseId }, data: {
      status: next, revision: { increment: 1 }, decisionMemo,
      ...(action === 'submit' ? {} : { reviewedBy: scope.actorUserId, reviewedAt: new Date() }),
      ...(financeVoucherId ? { financeVoucherId } : {}),
    } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `finance.expense.${action}`, entityType: 'FinanceExpense', entityId: expenseId, metadata: { workspaceId: scope.workspaceId, from: current.status, to: next, revision: updated.revision, financeVoucherId } } });
    return { expense: { ...updated, amount: updated.amount.toFixed(6) }, financeVoucherId };
  });
}
