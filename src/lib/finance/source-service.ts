import {readWmsOverseasChargeSource} from '@/lib/wms/overseas-charge-service';
import {assertFinanceAction} from './access';
import { readFxRevaluationSource } from './fx-revaluation-service';
import { readWmsInventoryRiskSource } from '@/lib/wms/inventory-risk-service';
import { readWmsCostAdjustmentSource } from '@/lib/wms/cost-adjustment-service';
import { readPurchaseInvoiceFinanceSource, readPurchasePaymentFinanceSource } from '@/lib/procurement/finance-source-query';
import { readPurchaseRefundFinanceSource } from '@/lib/procurement/finance-source-query';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { scoped,json } from '@/lib/wms/access';
import { lockKey, type Tx } from '@/lib/wms/repository';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireText, strictKeys } from '@/lib/wms/rules';
import { readFbaFinanceSource } from '@/lib/fba-local/finance-source-query';
import { readWmsFinanceSource } from '@/lib/wms/finance-source-query';
import { createLedgerVoucher } from './ledger-service';
import { mapSourceLines, parseSourceIdentity, sourceFingerprint, validateSourceDate, type FinanceSourceKind } from './source-rules';

const readSource = (tx: Tx, scope: WmsScope, kind: FinanceSourceKind, id: string) => kind==='WMS_OVERSEAS_CHARGE'?readWmsOverseasChargeSource(tx,scope,id):kind === 'FX_REVALUATION' ? readFxRevaluationSource(tx,scope,id) : kind === 'WMS_INVENTORY_RISK' ? readWmsInventoryRiskSource(tx, scope, id) : kind === 'PURCHASE_PAYMENT' ? readPurchasePaymentFinanceSource(tx, scope, id) : kind === 'PURCHASE_REFUND' ? readPurchaseRefundFinanceSource(tx, scope, id) : kind === 'PURCHASE_INVOICE' ? readPurchaseInvoiceFinanceSource(tx, scope, id) : kind === 'WMS_COST_ADJUSTMENT' ? readWmsCostAdjustmentSource(tx, scope, id) : kind === 'FBA_ADJUSTMENT' ? readFbaFinanceSource(tx, scope, id) : readWmsFinanceSource(tx, scope, id);
export async function previewFinanceSource(scope: WmsScope, params: URLSearchParams) {
  const { kind, id } = parseSourceIdentity(params.get('kind'), params.get('id'));
  return prisma.$transaction(async tx => {
    await assertFinanceAction(tx,scope,'view');
    const source = await readSource(tx, scope, kind, id);
    return { kind, id, sourceKey: source.sourceKey, currency: source.currency, sourceDate: source.sourceDate, lines: source.lines, fingerprint: sourceFingerprint(source), postingExecuted: false };
  });
}
export async function importFinanceSource(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ['kind', 'id', 'fingerprint', 'periodId', 'date', 'accountMapping']);
  const { kind, id } = parseSourceIdentity(body.kind, body.id);
  const fingerprint = requireText(body.fingerprint, '来源摘要');
  const periodId = requireText(body.periodId, '正式期间 ID');
  const date = requireText(body.date, '会计日期');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new WmsError('会计日期无效。', 400);
  return prisma.$transaction(async tx => {
    await assertFinanceAction(tx,scope,'create');
    const source = await readSource(tx, scope, kind, id);
    if (sourceFingerprint(source) !== fingerprint) throw new WmsError('来源已变化，请重新预览。', 409);
    validateSourceDate(source, date);
    const period = await tx.financePeriod.findFirst({ where: { ...scoped(scope), id: periodId, book: { enabled: true } }, include: { book: true } });
    if (!period) throw new WmsError('正式期间或账套不存在。', 404);
    if(kind==='FX_REVALUATION'&&(source.evidence as {bookId?:string}).bookId!==period.bookId)throw new WmsError('汇兑重估只能转入原账套。',422);
    const lines = mapSourceLines(source, period.book.currency, body.accountMapping);
    if(kind==='FX_REVALUATION'){if((source.evidence as {periodId?:string}).periodId!==periodId)throw new WmsError('汇兑重估须转入原期间。',422);if((body.accountMapping as {sourceAccount:string;subjectId:string}[]).some(row=>row.sourceAccount.trim()!==row.subjectId.trim()))throw new WmsError('汇兑重估须沿用已复核的明确科目，不能转入时改配。',422);}
    if (lines.length < 2 || lines.length > 200) throw new WmsError('来源须有 2 至 200 条非零分录。', 422);
    // One source can be claimed once across books in the workspace, including concurrent requests.
    await lockKey(tx, JSON.stringify(['finance-source', scoped(scope), source.sourceKey]));
    const claim = await tx.financeVoucher.findFirst({ where: { ...scoped(scope), sourceKey: source.sourceKey } });
    if (claim && claim.bookId !== period.bookId) throw new WmsError('该来源已转入其他账套。', 409);
    const digest = createHash('sha256').update(source.sourceKey).digest('hex');
    const result = await createLedgerVoucher(tx, scope, {
      periodId, date, sourceKey: source.sourceKey, idempotencyKey: `SOURCE:${digest}`,
      memo: `${kind}:${id}:${fingerprint}`,
      lines: lines.map(line => ({ ...line, debit: new Prisma.Decimal(line.debit), credit: new Prisma.Decimal(line.credit), memo: '' })),
    });
    if (!result.reused) await tx.auditLog.create({ data: {
      organizationId: scope.organizationId, userId: scope.actorUserId, action: 'finance.source.import', entityType: 'FinanceVoucher', entityId: result.voucher.id,
      metadata: json({ workspaceId: scope.workspaceId, kind, sourceId: id, sourceKey: source.sourceKey, fingerprint, bookId: period.bookId, periodId, date, inventoryDetails:kind==='WMS_COMMAND'?inventoryDetails(source.evidence):[], sourceEvidence: source.evidence as Prisma.InputJsonValue, accountMapping: (body.accountMapping as Array<{ sourceAccount: string; subjectId: string }>).map(row => ({ sourceAccount: row.sourceAccount.trim(), subjectId: row.subjectId.trim() })).sort((a, b) => a.sourceAccount.localeCompare(b.sourceAccount)), postingExecuted: false }),
    } });
    return { ...result, postingExecuted: false };
  });
}

function inventoryDetails(evidence:unknown){
 const entries=(evidence as {entries:Record<string,unknown>[]}).entries;let lineNumber=1;
 return entries.map(entry=>{const nonzero=entry.amount!=='0.000000',row={...entry,debitLineNumber:nonzero?lineNumber:null,creditLineNumber:nonzero?lineNumber+1:null};if(nonzero)lineNumber+=2;return row;});
}
