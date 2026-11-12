import { prisma } from '@/lib/db/prisma';
import { scoped, json } from '@/lib/wms/access';
import type { Tx } from '@/lib/wms/repository';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText, strictKeys } from '@/lib/wms/rules';
import { closeDigest, parseCloseEvidence, parseClosePolicy } from './close-rules';
import { assertFinanceReviewer, assertFinanceAction } from './access';

/** Book lock serializes ledger/open-item/expense writers. External domains require scoped review evidence. */
export async function readCloseSnapshot(tx: Tx, scope: WmsScope, bookId: string, periodId: string) {
  const where = { ...scoped(scope), bookId };
  const [vouchers, openings, expenses, items, settlements, bankStatements, bankMatches, fxRevaluations] = await Promise.all([
    tx.financeVoucher.findMany({ where: { ...where, periodId }, orderBy: { id: 'asc' }, select: { id: true, revision: true, status: true, sourceKey:true } }),
    tx.financeOpeningBalance.findMany({ where: { ...where, periodId }, orderBy: { id: 'asc' }, select: { id: true, revision: true } }),
    tx.financeExpense.findMany({ where: { ...where, periodId }, orderBy: { id: 'asc' }, select: { id: true, revision: true, status: true, financeVoucherId: true } }),
    tx.financeOpenItem.findMany({ where, orderBy: { id: 'asc' }, select: { id: true, revision: true, status: true } }),
    tx.financeSettlement.findMany({ where, orderBy: { id: 'asc' }, select: { id: true, reversedAt: true } }),
    tx.financeBankStatement.findMany({ where, orderBy: { id: 'asc' }, select: { id: true, requestHash: true } }),
    tx.financeBankMatch.findMany({ where, orderBy: { id: 'asc' }, select: { id: true, reversedAt: true } }),
    tx.financeFxRevaluation.findMany({where:{...where,periodId},orderBy:{id:'asc'},select:{id:true,status:true,requestHash:true,sourceCurrency:true,calculation:true}}),
  ]);
  const unpostedVouchers = vouchers.filter(row => row.status !== 'POSTED').length;
  const unprocessedExpenses = expenses.filter(row => ['DRAFT', 'SUBMITTED'].includes(row.status) || (row.status === 'APPROVED' && !row.financeVoucherId)).length;
  const unprocessedFx=fxRevaluations.filter(row=>{
    if(row.status==='CANCELLED')return false;if(row.status!=='REVIEWED')return true;
    const calculation=row.calculation as {lines?:unknown[]};return Boolean(calculation.lines?.length)&&!vouchers.some(voucher=>voucher.sourceKey===`FX-REVALUATION:${periodId}:${row.sourceCurrency}`);
  }).length;
  return { hash: closeDigest({ vouchers, openings, expenses, items, settlements, bankStatements, bankMatches, fxRevaluations }), unpostedVouchers, unprocessedExpenses:unprocessedExpenses+unprocessedFx, counts: { vouchers: vouchers.length, openings: openings.length, expenses: expenses.length, bookOpenItems: items.length, bookSettlements: settlements.length, fxRevaluations:fxRevaluations.length, unprocessedFx } };
}
export async function requireBusinessCloseReview(tx: Tx, scope: WmsScope, period: { id: string; bookId: string; revision: number }, reviewId: string, rawPolicy: unknown) {
  const policy = parseClosePolicy(rawPolicy);
  const review = await tx.financeCloseReview.findFirst({ where: { ...scoped(scope), bookId: period.bookId, periodId: period.id, id: reviewId, status: 'APPROVED' } });
  if (!review || !review.reviewedBy || review.periodRevision !== period.revision || review.policyHash !== closeDigest(policy)) throw new WmsError('须重新提交当前期间和制度版本的独立关账复核。', 409);
  await assertFinanceReviewer(tx, scope, review.reviewedBy);
  const snapshot = await readCloseSnapshot(tx, scope, period.bookId, period.id);
  if (snapshot.hash !== review.ledgerHash || snapshot.unpostedVouchers || snapshot.unprocessedExpenses) throw new WmsError('复核后账务已变化或存在未处理单据，须重新核对。', 409);
  parseCloseEvidence(review.evidence, policy);
  return { coverage: 'REGISTERED_LEDGER_AND_INDEPENDENT_SOURCE_REVIEW', reviewId: review.id, ledgerHash: snapshot.hash, policyReference: policy.reference, completenessEvidenceType: 'INDEPENDENT_USER_ATTESTATION', automaticExternalReconciliation: false, counts: snapshot.counts };
}
export async function queryCloseReviews(scope: WmsScope, params: URLSearchParams) {
  const bookId = requireText(params.get('bookId'), '账套 ID'), periodId = requireText(params.get('periodId'), '期间 ID');
  return prisma.$transaction(async tx=>{await assertFinanceAction(tx,scope,'view');return { reviews: await tx.financeCloseReview.findMany({ where: { ...scoped(scope), bookId, periodId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 }) };});
}
export async function mutateCloseReview(scope: WmsScope, body: Record<string, unknown>) {
  const action = requireText(body.action, '关账复核动作');
  if (!['configure-policy', 'request-review', 'decide-review'].includes(action)) throw new WmsError('关账复核动作无效。', 400);
  strictKeys(body, action === 'configure-policy' ? ['action', 'bookId', 'revision', 'policy'] : action === 'request-review' ? ['action', 'bookId', 'periodId', 'revision', 'evidence'] : ['action', 'bookId', 'reviewId', 'approve', 'evidence']);
  const bookId = requireText(body.bookId, '账套 ID');
  return prisma.$transaction(async tx => {
    await assertFinanceAction(tx,scope,action==='request-review'?'create':'approve');
    await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
    const book = await tx.financeBook.findFirst({ where: { ...scoped(scope), id: bookId, enabled: true } });
    if (!book) throw new WmsError('账套不存在。', 404);
    if (action === 'configure-policy') {
      await assertFinanceReviewer(tx, scope, scope.actorUserId);
      if (book.revision !== requireRevision(body.revision)) throw new WmsError('账套版本已变化。', 409);
      const policy = parseClosePolicy(body.policy);
      const updated = await tx.financeBook.update({ where: { id: bookId }, data: { closePolicy: json(policy), revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.close.configure-policy', entityType: 'FinanceBook', entityId: bookId, metadata: { workspaceId: scope.workspaceId, policy: json(policy), revision: updated.revision } } });
      return { book: updated };
    }
    let review;
    if (action === 'request-review') {
      const periodId = requireText(body.periodId, '期间 ID'), revision = requireRevision(body.revision);
      const period = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId, bookId } });
      if (!period || period.status !== 'OPEN' || period.revision !== revision) throw new WmsError('期间须为当前版本的开放期间。', 409);
      const policy = parseClosePolicy(book.closePolicy), evidence = parseCloseEvidence(body.evidence, policy), snapshot = await readCloseSnapshot(tx, scope, bookId, periodId);
      if (snapshot.unpostedVouchers || snapshot.unprocessedExpenses) throw new WmsError('存在未过账凭证或未处理费用，不能申请关账复核。', 409);
      const prior = await tx.financeCloseReview.findFirst({ where: { ...scoped(scope), bookId, periodId, periodRevision: revision, policyHash: closeDigest(policy), ledgerHash: snapshot.hash, requestedBy: scope.actorUserId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
      if (prior && closeDigest(prior.evidence) === closeDigest(evidence)) return { review: prior, reused: true };
      review = await tx.financeCloseReview.create({ data: { id: crypto.randomUUID(), ...scoped(scope), bookId, periodId, periodRevision: revision, policyHash: closeDigest(policy), ledgerHash: snapshot.hash, evidence: json(evidence), requestedBy: scope.actorUserId } });
    } else {
      await assertFinanceReviewer(tx, scope, scope.actorUserId);
      const reviewId = requireText(body.reviewId, '复核 ID'), evidence = requireText(body.evidence, '审核意见', 2000);
      if (typeof body.approve !== 'boolean') throw new WmsError('须明确审核决定。', 400);
      const prior = await tx.financeCloseReview.findFirst({ where: { ...scoped(scope), bookId, id: reviewId } });
      if (!prior) throw new WmsError('复核记录不存在。', 404);
      if (prior.requestedBy === scope.actorUserId) throw new WmsError('关账复核禁止申请人自审。', 403);
      const status = body.approve ? 'APPROVED' : 'REJECTED';
      if (prior.status !== 'PENDING') {
        if (prior.status !== status || prior.reviewedBy !== scope.actorUserId || prior.decisionEvidence !== evidence) throw new WmsError('复核决定不可覆盖。', 409);
        return { review: prior, reused: true };
      }
      const period = await tx.financePeriod.findFirst({ where: { ...scoped(scope), bookId, id: prior.periodId } });
      const snapshot = await readCloseSnapshot(tx, scope, bookId, prior.periodId);
      if (!period || period.status !== 'OPEN' || period.revision !== prior.periodRevision || closeDigest(parseClosePolicy(book.closePolicy)) !== prior.policyHash || snapshot.hash !== prior.ledgerHash) throw new WmsError('期间、制度或账务已变化，须重新申请。', 409);
      review = await tx.financeCloseReview.update({ where: { id: reviewId }, data: { status, reviewedBy: scope.actorUserId, reviewedAt: new Date(), decisionEvidence: evidence } });
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actorUserId, action: `finance.close.${action}`, entityType: 'FinanceCloseReview', entityId: review.id, metadata: { workspaceId: scope.workspaceId, bookId, periodId: review.periodId, ledgerHash: review.ledgerHash, status: review.status } } });
    return { review, reused: false };
  });
}
