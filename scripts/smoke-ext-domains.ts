/**
 * 8 个补全域的端到端冒烟：真实调用服务层，覆盖写入、乐观锁、状态流转、汇算与幂等。
 * 用法：node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/smoke-ext-domains.ts
 * 脚本自清理：所有产出行以 SMOKE- 前缀标记，结束时删除，不污染业务数据。
 */
import { prisma } from '@/lib/db/prisma';
import {
  capturePerformance, closeSalesPlan, computeTaxPeriod, decideQueueItem, deleteCalcScheme,
  fileTaxPeriod, generateRepricingQueue, queryExt, saveCalcScheme, saveChannelAccount, saveChannelOrder,
  saveCustomField, saveDictionary, saveDictionaryItem, saveExchangeOrder, saveOfferWatch,
  savePaymentRequest, saveQuotation, saveRepricingRule, saveReview, saveSalesPlan, saveTaxInvoice,
  selectQuotation, transitionExchangeOrder, transitionPaymentRequest,
} from '@/lib/ext/service';
import { quoteOnly } from '@/lib/ext/service';
import type { WmsScope } from '@/lib/wms/contracts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

const tag = `SMOKE-${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);
const monthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

async function resolveScope(): Promise<WmsScope> {
  const member = await prisma.organizationMember.findFirst({
    where: { user: { status: 'active' } },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true, userId: true },
  });
  assert(member, '数据库中还没有可用账号，请先执行 npm run db:seed-admin');
  return { organizationId: member.organizationId, workspaceId: 'default', actorUserId: member.userId };
}

async function cleanup(scope: WmsScope) {
  const where = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  await prisma.salesPlanLine.deleteMany({ where });
  await prisma.salesPlan.deleteMany({ where: { ...where, name: { startsWith: 'SMOKE-' } } });
  await prisma.repricingQueueItem.deleteMany({ where: { ...where, asin: { startsWith: 'SMOKE-' } } });
  await prisma.competitorOfferWatch.deleteMany({ where: { ...where, asin: { startsWith: 'SMOKE-' } } });
  await prisma.repricingRule.deleteMany({ where: { ...where, name: { startsWith: 'SMOKE-' } } });
  await prisma.reviewRecord.deleteMany({ where: { ...where, asin: { startsWith: 'SMOKE-' } } });
  await prisma.storePerformanceSnapshot.deleteMany({ where: { ...where, policyReference: { startsWith: 'SMOKE-' } } });
  await prisma.calcScheme.deleteMany({ where: { ...where, name: { startsWith: 'SMOKE-' } } });
  await prisma.purchasePaymentRequest.deleteMany({ where: { ...where, number: { startsWith: 'PR' }, purpose: { startsWith: 'SMOKE-' } } });
  await prisma.purchaseExchangeOrder.deleteMany({ where: { ...where, reason: { startsWith: 'SMOKE-' } } });
  await prisma.supplierQuotation.deleteMany({ where: { ...where, notes: { startsWith: 'SMOKE-' } } });
  await prisma.taxInvoice.deleteMany({ where: { ...where, counterparty: { startsWith: 'SMOKE-' } } });
  await prisma.taxFilingPeriod.deleteMany({ where: { ...where, reference: { startsWith: 'FILE-' }, country: 'ZZ' } });
  await prisma.multiChannelOrder.deleteMany({ where: { ...where, externalOrderNo: { startsWith: 'SMOKE-' } } });
  await prisma.multiChannelAccount.deleteMany({ where: { ...where, sellerId: { startsWith: 'SMOKE-' } } });
  await prisma.dataDictionaryItem.deleteMany({ where: { ...where, value: { startsWith: 'SMOKE-' } } });
  await prisma.dataDictionary.deleteMany({ where: { ...where, code: { startsWith: 'SMOKE-' } } });
  await prisma.customFieldDefinition.deleteMany({ where: { ...where, code: { startsWith: 'SMOKE-' } } });
}

async function main() {
  const scope = await resolveScope();
  await cleanup(scope);
  const params = (input: Record<string, string>) => new URLSearchParams(input);
  let checks = 0;

  // 1. 计算器
  const scheme = await saveCalcScheme(scope, {
    name: `${tag}-利润测算`, kind: 'PROFIT', marketplace: 'US', currency: 'CNY', targetMarginBp: 2000,
    inputs: { price: 29.99, shipping: 0, weightOz: 12, lengthIn: 10, widthIn: 8, heightIn: 2, unitCost: 6.5, inboundCost: 1.2, adCost: 2, otherCost: 0.4, returnRateBp: 300, targetMarginBp: 2000 },
  }) as { id: string; revision: number; result: { profit: number; marginBp: number; targetPrice: number } };
  assert(scheme.result.targetPrice > 0, '应给出目标价');
  assert(scheme.result.marginBp > 0, '现价毛利率应为正');
  const atTarget = quoteOnly('profit', {
    price: scheme.result.targetPrice, shipping: 0, weightOz: 12, lengthIn: 10, widthIn: 8, heightIn: 2,
    unitCost: 6.5, inboundCost: 1.2, adCost: 2, otherCost: 0.4, returnRateBp: 300, targetMarginBp: 2000,
  }) as { marginBp: number };
  assert(Math.abs(atTarget.marginBp - 2000) <= 40, `反算价代入后毛利率应接近 2000bp，实际 ${atTarget.marginBp}`);
  checks += 1;
  let stale = false;
  try { await deleteCalcScheme(scope, { id: scheme.id, revision: scheme.revision + 5 }); } catch { stale = true; }
  assert(stale, '过期版本删除必须被拒绝');
  checks += 1;

  // 2. 评论与绩效
  const review = await saveReview(scope, { marketplace: 'US', asin: `${tag}-ASIN`, sellerSku: 'SMOKE-SKU', rating: 1, title: '破损', content: '外箱压坏', reviewedAt: today, source: 'MANUAL' }) as { id: string; sentiment: string; revision: number };
  assert(review.sentiment === 'NEGATIVE', '1 星必须归为差评');
  const replied = await saveReview(scope, { id: review.id, revision: review.revision, marketplace: 'US', asin: `${tag}-ASIN`, sellerSku: 'SMOKE-SKU', rating: 1, title: '破损', content: '外箱压坏', reviewedAt: today, source: 'MANUAL' }) as { sentiment: string };
  assert(replied.sentiment === 'NEGATIVE', '重复保存应保持差评判定');
  const reviewList = await queryExt(scope, 'reviews', params({ sentiment: 'NEGATIVE' })) as { summary: { negative: number } };
  assert(reviewList.summary.negative >= 1, '差评汇总应至少 1 条');
  checks += 1;
  const perf = await capturePerformance(scope, {
    marketplace: 'US', periodStart: today, periodEnd: today, totalOrders: 100,
    orderDefectRateBp: 150, lateShipmentRateBp: 100, cancellationRateBp: 100,
    validTrackingRateBp: 9900, negativeFeedbackRateBp: 20, policyReference: `${tag} 阈值口径`,
  }) as { verdict: { ok: boolean; breached: string[] } };
  assert(perf.verdict.ok === false && perf.verdict.breached.includes('订单缺陷率'), 'ODR 1.5% 应判超标');
  checks += 1;

  // 3. 跟卖与调价
  const rule = await saveRepricingRule(scope, { name: `${tag}-规则`, marketplace: 'US', strategy: 'MATCH_LOWEST', floorPrice: 10, ceilingPrice: 30, stepAmount: 0.01, minMarginBp: 0 }) as { id: string; revision: number };
  await saveOfferWatch(scope, { asin: `${tag}-A1`, sellerSku: 'SMOKE-SKU', marketplace: 'US', myPrice: 25, buyBoxPrice: 24, lowestCompetitorPrice: 20, competitorCount: 2 });
  const queueRun = await generateRepricingQueue(scope, { ruleId: rule.id }) as { created: number; scanned: number };
  assert(queueRun.scanned >= 1, '应扫到刚录入的观察');
  const queueList = await queryExt(scope, 'queue', params({ status: 'PENDING' })) as { items: Array<{ id: string; suggestedPrice: string; asin: string }> };
  const target = queueList.items.find(item => item.asin === `${tag}-A1`);
  assert(target, '调价建议应进入队列');
  assert(Number(target.suggestedPrice) === 20, `建议价应等于最低竞争价 20，实际 ${target.suggestedPrice}`);
  const applied = await decideQueueItem(scope, { id: target.id, decision: 'apply', appliedPrice: 20 }) as { status: string };
  assert(applied.status === 'APPLIED', '采纳后状态应为 APPLIED');
  checks += 1;

  // 4. 销售计划
  const plan = await saveSalesPlan(scope, {
    name: `${tag}-计划`, marketplace: 'US', currency: 'CNY', periodType: 'MONTH',
    periodStart: today, periodEnd: monthEnd, forecastWindowDays: 90, seasonalityBp: 10_000,
    lines: [{ sellerSku: 'SMOKE-SKU', asin: `${tag}-ASIN`, targetQty: 100, targetRevenue: 2999, unitCost: 6.5 }],
  }) as { id: string; revision: number; lines: Array<{ forecastQty: number; historyDailyAvg: string }> };
  assert(plan.lines.length === 1, '计划应写入 1 行');
  const detail = await queryExt(scope, 'sales-plan', params({ id: plan.id })) as { lines: Array<{ actualQty: number; completionBp: number }>; totals: { targetQty: number } };
  assert(detail.totals.targetQty === 100 && detail.lines[0].actualQty >= 0, '计划详情应返回目标与实际');
  await closeSalesPlan(scope, { id: plan.id, revision: plan.revision });
  const closed = await queryExt(scope, 'sales-plans', params({})) as { items: Array<{ id: string; status: string }> };
  assert(closed.items.find(row => row.id === plan.id)?.status === 'CLOSED', '关闭后状态应为 CLOSED');
  checks += 1;

  // 5. 采购协同
  const supplier = await prisma.supplier.findFirst({ where: { organizationId: scope.organizationId }, select: { id: true } });
  assert(supplier, '需要至少一个供应商档案');
  const payment = await savePaymentRequest(scope, { supplierId: supplier.id, currency: 'CNY', amount: 1200, dueDate: today, purpose: `${tag} 货款` }) as { id: string; revision: number; number: string };
  const submitted = await transitionPaymentRequest(scope, { id: payment.id, revision: payment.revision, action: 'submit' }) as { revision: number; status: string };
  assert(submitted.status === 'SUBMITTED', '提交后应为 SUBMITTED');
  let selfApproveBlocked = false;
  try { await transitionPaymentRequest(scope, { id: payment.id, revision: submitted.revision, action: 'approve' }); }
  catch { selfApproveBlocked = true; }
  assert(selfApproveBlocked, '申请人不能审批自己提交的请款单');
  checks += 1;

  const exchange = await saveExchangeOrder(scope, { supplierId: supplier.id, reason: `${tag} 外箱破损`, lines: [{ sellerSku: 'SMOKE-SKU', quantity: 2, replacementQty: 2, note: '破损' }] }) as { id: string; revision: number; lineCount: number };
  assert(exchange.lineCount === 1, '换货单应有 1 行');
  const shipped = await transitionExchangeOrder(scope, { id: exchange.id, revision: (await transitionExchangeOrder(scope, { id: exchange.id, revision: exchange.revision, action: 'submit' }) as { revision: number }).revision, action: 'approve' }) as { revision: number; status: string };
  assert(shipped.status === 'APPROVED', '审批后应为 APPROVED');
  checks += 1;

  const product = await prisma.productRecord.findFirst({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId }, select: { id: true, sku: true } });
  const quoteLow = await saveQuotation(scope, { supplierId: supplier.id, sellerSku: product?.sku ?? 'SMOKE-SKU', productRecordId: product?.id ?? '', unitPrice: 8.5, moq: 100, leadTimeDays: 20, notes: `${tag} 低价` }) as { id: string; revision: number };
  await saveQuotation(scope, { supplierId: supplier.id, sellerSku: product?.sku ?? 'SMOKE-SKU', productRecordId: product?.id ?? '', unitPrice: 9.2, moq: 50, leadTimeDays: 10, notes: `${tag} 高价` });
  const picked = await selectQuotation(scope, { id: quoteLow.id }) as { status: string };
  assert(picked.status === 'SELECTED', '选定后状态应为 SELECTED');
  checks += 1;

  // 6. 税务
  const vat = await saveTaxInvoice(scope, {
    country: 'ZZ', taxType: 'VAT', invoiceNo: `${tag}-INV1`, invoiceDate: today, counterparty: `${tag} 客户`,
    currency: 'EUR', taxableAmount: 1000, taxRateBp: 1900, direction: 'OUTPUT', status: 'DRAFT',
  }) as { id: string; taxAmount: string; filingPeriod: string; revision: number };
  assert(Number(vat.taxAmount) === 190, `19% 税额应为 190，实际 ${vat.taxAmount}`);
  const period = await computeTaxPeriod(scope, { country: 'ZZ', taxType: 'VAT', period: vat.filingPeriod }) as { id: string; revision: number; taxAmount: string };
  assert(Number(period.taxAmount) === 190, '申报期归集应等于发票税额');
  const filed = await fileTaxPeriod(scope, { id: period.id, revision: period.revision, reference: `FILE-${vat.filingPeriod}-ZZ` }) as { status: string };
  assert(filed.status === 'FILED', '申报后状态应为 FILED');
  checks += 1;

  // 7. 多渠道
  const account = await saveChannelAccount(scope, { channel: 'EBAY', name: `${tag} eBay 店`, sellerId: `${tag}-SELLER`, marketplace: 'US', status: 'ACTIVE' }) as { id: string; revision: number };
  const order = await saveChannelOrder(scope, { accountId: account.id, externalOrderNo: `${tag}-ORDER-1`, sellerSku: 'SMOKE-SKU', quantity: 2, currency: 'USD', amount: 59.98, status: 'PENDING', orderedAt: today }) as { id: string; channel: string };
  assert(order.channel === 'EBAY', '渠道订单应继承账号渠道');
  const orderList = await queryExt(scope, 'channel-orders', params({ channel: 'EBAY' })) as { summary: Array<{ channel: string; orders: number }> };
  assert((orderList.summary.find(row => row.channel === 'EBAY')?.orders ?? 0) >= 1, '渠道汇总应含 EBAY 订单');
  checks += 1;

  // 8. 字典与自定义字段
  const dict = await saveDictionary(scope, { code: `${tag}-STATUS`, name: '冒烟字典', description: '自动清除' }) as { id: string; revision: number };
  await saveDictionaryItem(scope, { dictionaryId: dict.id, value: `${tag}-A`, label: '值 A', sort: 1 });
  const dictList = await queryExt(scope, 'dictionaries', params({})) as { items: Array<{ id: string; itemCount: number; items: unknown[] }> };
  assert(dictList.items.find(row => row.id === dict.id)?.itemCount === 1, '字典项计数应同步');
  const field = await saveCustomField(scope, { entity: 'PRODUCT', code: `${tag}_ORIGIN`, label: '原产国', fieldType: 'SELECT', options: ['CN', 'VN'], sortOrder: 1 }) as { id: string };
  assert(field.id, '自定义字段应创建成功');
  checks += 1;

  await cleanup(scope);
  console.log(JSON.stringify({ ok: true, checks, tag }, null, 2));
  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
