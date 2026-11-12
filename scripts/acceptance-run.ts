/**
 * 采购全链路验收演练：用真实服务函数从「主数据 → 采购计划 → 采购单 → 收货质检 →
 * 计价 → 发票三单匹配 → 总账凭证 → 应付往来 → 付款核销」跑一遍，全程双账号（A 提交 / B 审批），
 * 每步断言库存、成本、金额与往来余额。
 *
 * 所有数据放在独立的验收组织里，不碰业务主库；默认保留数据供 UI 验收，--reset 可清理重跑。
 * 用法：
 *   node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/acceptance-run.ts
 *   node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/acceptance-run.ts --reset
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { WmsScope, WmsCommandInput, WmsCommandPayload } from '@/lib/wms/contracts';
import { createWmsResource } from '@/lib/wms/catalog-service';
import { requestApproval, decideApproval } from '@/lib/wms/approvals';
import { executeWmsCommand } from '@/lib/wms/application-service';
import { consumeInventoryValuation } from '@/lib/wms/valuation-service';
import { createPurchaseReceipt } from '@/lib/procurement/receipt-service';
import { createPurchasePlan, submitPurchasePlanApproval, decidePurchasePlanApproval, convertPurchasePlanToOrder } from '@/lib/procurement/plan-service';
import { submitPurchaseOrderApproval, decidePurchaseOrderApproval, placeApprovedPurchaseOrder, submitPurchasePaymentApproval, decidePurchasePaymentApproval, confirmPurchasePayment } from '@/lib/procurement/order-service';
import { createPurchaseInvoice, submitPurchaseInvoiceApproval, decidePurchaseInvoiceApproval, invoiceReconciliation } from '@/lib/procurement/invoice-service';
import { suggestPlanRows } from '@/lib/procurement/plan-service';
import { previewFinanceSource, importFinanceSource } from '@/lib/finance/source-service';
import { mutateFinanceLedger } from '@/lib/finance/ledger-service';
import { mutateFinanceOpenItems } from '@/lib/finance/open-item-service';

const IN_PLACE = process.argv.includes('--in-place');
const HOME_ORG = 'cmwdhm9ph0000o4ug8gd68zhd';
const RUN = Date.now().toString(36);
const ORG = process.env.ACC_ORG ?? (IN_PLACE ? HOME_ORG : `acc-org-${Date.now()}`);
const PREFIX = 'ACC-';
const WS = 'default';
const OPERATOR = `acc-operator-${RUN}`;
const APPROVER = `acc-approver-${RUN}`;
const SUPPLIER = `${PREFIX}sup-${RUN}`;
const PRODUCT = `${PREFIX}prod-${RUN}`;
const scope: WmsScope = { organizationId: ORG, workspaceId: WS, actorUserId: OPERATOR };
const approverScope: WmsScope = { ...scope, actorUserId: APPROVER };
const RESET = process.argv.includes('--reset');
if (RESET && IN_PLACE) throw new Error('禁止对当前业务组织执行 --reset；请改用独立验收组织。');

type AnyRecord = Record<string, unknown>;
const grants = { wms: ['view', 'create', 'edit', 'approve', 'export'], operations: ['view', 'create', 'edit', 'approve', 'export'], products: ['view', 'create', 'edit'] };
let stage = '初始化';
let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[${stage}] 断言失败：${message}`);
  checks += 1;
}
function step(name: string) { stage = name; console.log(`→ ${name}`); }
function text(value: { toString(): string }) { return value.toString(); }

/** 先按外键依赖顺序删，再对剩余表多轮兜底清理。 */
async function reset() {
  const ordered = [
    'FinanceSettlement', 'FinanceOpenItem', 'FinanceVoucherLine', 'FinanceVoucher', 'FinanceSubject', 'FinancePeriod', 'FinanceBook',
    'WmsCostEntry', 'WmsFinanceDraft', 'WmsMovement', 'WmsDomainEvent', 'WmsCommand', 'WmsApproval',
    'WmsStockBalance', 'WmsReceiptLine', 'WmsReceipt', 'WmsLocation', 'WmsLot', 'WmsArea', 'WmsWarehouse',
    'PurchaseInvoiceLine', 'PurchaseInvoiceApproval', 'PurchaseInvoice', 'PurchasePaymentApproval', 'PurchasePayment',
    'PurchaseOrderLine', 'PurchaseOrderApproval', 'PurchaseOrder', 'PurchasePlanLine', 'PurchasePlanApproval', 'PurchasePlan',
    'ProductRecord', 'Supplier', 'AuditLog', 'OrganizationMember', 'OrganizationRosterRole', 'WorkspaceScope',
  ];
  const del = async (table: string) => {
    try { return await prisma.$executeRawUnsafe(`DELETE FROM "public"."${table}" WHERE "organizationId" = '${ORG}'`); }
    catch { return 0; }
  };
  for (const table of ordered) await del(table);
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId' AND table_name <> 'Organization'`;
  for (let pass = 0; pass < 6; pass += 1) {
    let removed = 0;
    for (const { table_name } of tables) removed += await del(table_name);
    if (removed === 0) break;
  }
  await prisma.user.deleteMany({ where: { id: { in: [OPERATOR, APPROVER] } } }).catch(() => undefined);
  await prisma.organization.deleteMany({ where: { id: ORG } }).catch(() => undefined);
}

async function bootstrap() {
  step('主数据与双账号权限');
  if (!IN_PLACE) {
    await prisma.organization.create({ data: { id: ORG, name: '验收演练组织', slug: ORG } });
    await prisma.workspaceScope.create({ data: { organizationId: ORG, id: WS, name: '验收工作区' } });
    await prisma.organizationRosterRole.createMany({ data: [
      { organizationId: ORG, id: 'owner', name: '验收制单', description: 'full grants', permissions: grants as unknown as Prisma.InputJsonValue },
      { organizationId: ORG, id: 'operations_supervisor', name: '验收复核', description: 'full grants', permissions: grants as unknown as Prisma.InputJsonValue },
    ] });
  }
  // 现有组织已有 owner 角色，两个演练账号都挂 owner，保证 WMS 与财务动作齐权。
  const role = IN_PLACE ? 'owner' : undefined;
  for (const id of [OPERATOR, APPROVER]) {
    await prisma.user.create({ data: { id, email: `${id}@acceptance.invalid`, name: id, passwordHash: 'not-a-password' } });
    await prisma.organizationMember.create({ data: { organizationId: ORG, userId: id, role: role ?? (id === OPERATOR ? 'owner' : 'operations_supervisor') } });
  }
  await prisma.supplier.create({ data: { id: SUPPLIER, organizationId: ORG, name: '验收供应商', normalizedName: `${ORG}-${RUN}` } });
  const product = await prisma.productRecord.create({ data: { id: PRODUCT, organizationId: ORG, workspaceId: WS, userId: OPERATOR, sku: `ACC-SKU-${RUN}`, chineseName: '验收商品', payload: {} } });
  assert(product.id, '商品创建');
  const warehouse = await createWmsResource(scope, 'warehouses', { code: `ACC-WH-${RUN}`, name: '验收仓' }) as AnyRecord;
  const area = await createWmsResource(scope, 'areas', { warehouseId: warehouse.id, code: 'A', name: '验收区' }) as AnyRecord;
  const receiving = await createWmsResource(scope, 'locations', { areaId: area.id, code: 'R', kind: 'RECEIVING' }) as AnyRecord;
  const storage = await createWmsResource(scope, 'locations', { areaId: area.id, code: 'S', kind: 'STORAGE' }) as AnyRecord;
  return { productId: product.id, warehouseId: warehouse.id as string, receivingId: receiving.id as string, storageId: storage.id as string };
}

async function planToOrder(productId: string) {
  step('采购计划 → 需求推算 → 转采购单');
  const suggestion = await suggestPlanRows(scope, { salesWindowDays: 30, coverageDays: 30, safetyDays: 7, limit: 20 });
  assert(Array.isArray(suggestion), '需求推算返回列表');
  const plan = await createPurchasePlan(scope, {
    number: `${PREFIX}PLAN-${RUN}`, supplierId: SUPPLIER,
    periodStart: '2026-11-01', periodEnd: '2026-11-30',
    salesWindowDays: 30, coverageDays: 30, safetyDays: 7, notes: '验收演练',
    lines: [{ productRecordId: productId, plannedQty: 100, unitPrice: '10.000000', onHandQty: 0, inboundQty: 0, salesQty: 100, suggestedQty: 100 }],
  }) as AnyRecord;
  const planRow = (plan.plan ?? plan) as AnyRecord;
  assert(planRow.id, '计划创建');
  const submitted = await submitPurchasePlanApproval(scope, { action: 'submit-approval', id: planRow.id, revision: planRow.revision }) as AnyRecord;
  const approval = submitted.approval as AnyRecord;
  assert(approval.status === 'PENDING', '计划审批待办');
  await decidePurchasePlanApproval(approverScope, { decision: 'APPROVE', id: approval.id, revision: approval.revision, reason: '' });
  const currentPlan = await prisma.purchasePlan.findUniqueOrThrow({ where: { id: planRow.id as string } });
  const converted = await convertPurchasePlanToOrder(scope, { action: 'convert', id: planRow.id, revision: currentPlan.revision, orderNumber: `${PREFIX}PO-${RUN}`, expectedAt: '2026-11-20' }) as AnyRecord;
  const order = (converted.order ?? converted) as AnyRecord;
  assert(order.id, '计划转采购单');
  console.log(`  采购计划 ${text(planRow.number ?? planRow.id)} → 采购单 ${text(order.number ?? order.id)}`);
  return { orderId: order.id as string, orderRevision: Number(order.revision ?? 1) };
}

async function approveAndPlace(orderId: string, orderRevision: number) {
  step('采购单双账号审批 → 正式下单');
  const submitted = await submitPurchaseOrderApproval(scope, { action: 'submit-approval', id: orderId, revision: orderRevision }) as AnyRecord;
  const approval = submitted.approval as AnyRecord;
  assert(approval.status === 'PENDING', '采购单审批待办');
  await decidePurchaseOrderApproval(approverScope, { id: approval.id, revision: approval.revision, decision: 'APPROVE', reason: '' });
  const currentOrder = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
  const placed = await placeApprovedPurchaseOrder(scope, { action: 'place-order', id: orderId, revision: currentOrder.revision }) as AnyRecord;
  const order = (placed.order ?? placed) as AnyRecord;
  assert(order.status === 'ORDERED', '采购单状态应为 ORDERED');
  console.log(`  采购单 ${text(order.number)} 已下单，版本 ${order.revision}`);
  return Number(order.revision);
}

async function receive(orderId: string, orderRevision: number, receivingId: string, storageId: string) {
  step('收货 → 质检 → 上架（命令管道 + 独立审批）');
  const created = await createPurchaseReceipt(scope, { action: 'create-receipt', id: orderId, revision: orderRevision, receivingLocationId: receivingId }) as AnyRecord;
  const receipt = created.receipt as AnyRecord;
  const lines = receipt.lines as AnyRecord[];
  assert(lines.length === 1, '收货单应有一行');
  const lineId = lines[0].id as string;
  const lotId = lines[0].lotId as string;
  // 成本规则必须在收货流水发生前激活：计价按 movement.occurredAt 取当时有效的规则。
  const rule = await createWmsResource(scope, 'cost-rules', {
    lotId, unitCost: '10.000000', currency: 'CNY', inventoryAccount: 'ACC_INVENTORY',
    offsetAccounts: { RECEIVE: 'ACC_PAYABLE', TRANSFER_ORDER_SHIP: 'ACC_PAYABLE', TRANSFER_ORDER_RECEIVE: 'ACC_PAYABLE', STOCKTAKE_POST: 'ACC_PAYABLE' },
    reference: `${PREFIX}标准成本依据-${RUN}`,
  }) as AnyRecord;
  const activate: WmsCommandInput = { workspaceId: WS, aggregateId: rule.id as string, expectedRevision: 1, idempotencyKey: `${PREFIX}activate-${RUN}`, payload: { action: 'ACTIVATE_COST_RULE', reason: '验收激活' } };
  const ruleApproval = await requestApproval(scope, activate);
  await decideApproval(approverScope, ruleApproval.id, ruleApproval.revision, true);
  await executeWmsCommand(scope, activate, ruleApproval.id);
  console.log(`  成本规则 ${rule.id} 已激活（收货前）`);
  let seq = 0;
  const command = (expectedRevision: number, payload: WmsCommandPayload): WmsCommandInput => ({ workspaceId: WS, aggregateId: receipt.id as string, expectedRevision, idempotencyKey: `${PREFIX}cmd-${RUN}-${++seq}`, payload });
  const run = async (input: WmsCommandInput) => {
    const approval = await requestApproval(scope, input);
    assert(approval.status === 'PENDING', 'WMS 审批待办');
    await decideApproval(approverScope, approval.id, approval.revision, true);
    return executeWmsCommand(scope, input, approval.id) as unknown as AnyRecord;
  };
  const received = await run(command(1, { action: 'RECEIVE', lines: [{ lineId, quantity: 100 }] }));
  assert(Number(received.revision) === 2, '收货后聚合版本应为 2');
  const inspected = await run(command(2, { action: 'INSPECT', lines: [{ lineId, acceptedQty: 100, rejectedQty: 0 }] }));
  assert(Number(inspected.revision) === 3, '质检后聚合版本应为 3');
  const putaway = await run(command(3, { action: 'PUTAWAY', lines: [{ lineId, locationId: storageId, quantity: 100 }] }));
  assert(Number(putaway.revision) === 4, '上架后聚合版本应为 4');
  const row = await prisma.wmsReceiptLine.findFirstOrThrow({ where: { id: lineId } });
  assert(row.acceptedQty === 100 && row.putawayQty === 100, '合格数与上架数应为 100');
  const balances = await prisma.wmsStockBalance.findMany({ where: { organizationId: ORG, workspaceId: WS }, select: { onHand: true } });
  const onHand = balances.reduce((sum, row) => sum + row.onHand, 0);
  assert(onHand === 100, `库存应在库 100，实际 ${onHand}`);
  console.log(`  收货单 ${text(receipt.number)}：合格 100 / 上架 100 / 在库 ${onHand}`);
  return { receiptId: receipt.id as string, commandId: received.commandId as string, lotId: lines[0].lotId as string };
}

async function valuation(commandId: string) {
  step('事件计价 → 收货计价凭证');
  const event = await prisma.wmsDomainEvent.findFirst({ where: { organizationId: ORG, workspaceId: WS, commandId } });
  assert(event, '收货命令应产生领域事件');
  await prisma.$transaction(tx => consumeInventoryValuation(tx, event));
  const draft = await prisma.wmsFinanceDraft.findFirst({ where: { organizationId: ORG, workspaceId: WS, commandId } });
  assert(draft && draft.status === 'DRAFT', '计价草稿应为 DRAFT');
  const entries = await prisma.wmsCostEntry.findMany({ where: { organizationId: ORG, workspaceId: WS, draftId: draft.id } });
  assert(entries.length > 0, '计价分录应生成');
  const total = entries.reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
  assert(total.toFixed(6) === '1000.000000', `收货计价金额应为 1000，实际 ${total.toFixed(6)}`);
  console.log(`  计价草稿 ${draft.id}：${entries.length} 条分录，合计 ${total.toFixed(6)}`);
  return draft.id;
}

async function invoice(orderId: string) {
  step('采购发票三单匹配 → 双账号核准');
  const created = await createPurchaseInvoice(scope, {
    number: `${PREFIX}INV-${RUN}`, supplierInvoiceNo: `SUP-ACC-${RUN}`, purchaseOrderId: orderId,
    invoiceDate: '2026-11-10', dueDate: '2026-12-10', currency: 'CNY',
    lines: [{ productRecordId: PRODUCT, invoicedQty: 100, unitPrice: '10.000000', taxAmount: '130.000000' }],
  }) as AnyRecord;
  const inv = (created.invoice ?? created) as AnyRecord;
  assert(inv.matchStatus === 'MATCHED', `三单应一致，实际 ${inv.matchStatus}`);
  assert(text(inv.totalAmount) === '1130.000000' || Number(inv.totalAmount) === 1130, '价税合计应为 1130');
  const submitted = await submitPurchaseInvoiceApproval(scope, { action: 'submit-approval', id: inv.id, revision: inv.revision }) as AnyRecord;
  const approval = submitted.approval as AnyRecord;
  await decidePurchaseInvoiceApproval(approverScope, { decision: 'APPROVE', id: approval.id, revision: approval.revision, reason: '' });
  const row = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: inv.id as string } });
  assert(row.status === 'APPROVED', '发票应已核准');
  const recon = await invoiceReconciliation(scope, orderId);
  assert(recon.lines[0].remainingQty === 0, '该采购单应已开完票');
  console.log(`  发票 ${row.number}：匹配 ${row.matchStatus}，价税合计 ${row.totalAmount.toFixed(6)}，剩余可开 0`);
  return { invoiceId: row.id, orderRevision: (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).revision };
}

async function payment(orderId: string) {
  step('采购付款申请 → 独立复核 → 申请人确认登记');
  const submitted = await submitPurchasePaymentApproval(scope, {
    action: 'submit-payment-approval', id: orderId, amount: '1000.000000', paidAt: '2026-11-12',
    method: 'BANK', reference: `${PREFIX}PAY-${RUN}`, notes: '验收付款',
  }) as AnyRecord;
  const approval = submitted.approval as AnyRecord;
  assert(approval.status === 'PENDING', '付款复核待办');
  await decidePurchasePaymentApproval(approverScope, { id: approval.id, revision: approval.revision, decision: 'APPROVE', reason: '' });
  const confirmed = await confirmPurchasePayment(scope, { action: 'confirm-payment', id: approval.id, revision: Number(approval.revision) + 1 }) as AnyRecord;
  const pay = (confirmed.payment ?? confirmed) as AnyRecord;
  assert(pay.id, '付款应已登记');
  const row = await prisma.purchasePayment.findUniqueOrThrow({ where: { id: pay.id as string } });
  assert(row.amount.toFixed(6) === '1000.000000', '付款金额应为 1000（采购单可付余额不含税）');
  console.log(`  付款 ${row.reference}：${row.amount.toFixed(6)} ${row.currency}`);
  return row.id;
}

async function ledger() {
  step('总账基础资料：账套 / 期间 / 科目');
  const book = (await mutateFinanceLedger(scope, { action: 'create-book', code: `ACC${RUN}`, name: '验收账套', currency: 'CNY' }) as AnyRecord).book as AnyRecord;
  const period = (await mutateFinanceLedger(scope, { action: 'create-period', bookId: book.id, code: `2026-11-${RUN}`, start: '2026-11-01', end: '2026-11-30' }) as AnyRecord).period as AnyRecord;
  await mutateFinanceLedger(approverScope, { action: 'open-period', periodId: period.id, revision: period.revision });
  const subjects: Record<string, string> = {};
  for (const [key, code, name, side] of [
    ['inventory', '1405', '库存商品', 'DEBIT'], ['vat', '222101', '应交税费—进项税额', 'DEBIT'],
    ['payable', '2202', '应付账款', 'CREDIT'], ['cash', '1002', '银行存款', 'DEBIT'],
    ['cost', '6401', '主营业务成本', 'DEBIT'],
  ] as const) {
    const subject = (await mutateFinanceLedger(scope, { action: 'create-subject', bookId: book.id, parentId: '', code, name, normalSide: side }) as AnyRecord).subject as AnyRecord;
    subjects[key] = subject.id as string;
  }
  console.log(`  账套 ACC / 期间 2026-11 / ${Object.keys(subjects).length} 个末级科目`);
  return { bookId: book.id as string, periodId: period.id as string, subjects };
}

async function importAndPost(kind: string, id: string, sourceAccounts: Record<string, string>, subjects: Record<string, string>, periodId: string, date: string) {
  const preview = await previewFinanceSource(scope, new URLSearchParams({ kind, id })) as AnyRecord;
  const lines = preview.lines as Array<{ account: string; debit: string; credit: string }>;
  assert(lines.length >= 2, `${kind} 应有分录`);
  const mapping = [...new Set(lines.map(line => line.account))].map(account => ({ sourceAccount: account, subjectId: sourceAccounts[account] ?? subjects.payable }));
  const imported = await importFinanceSource(scope, {
    kind, id, fingerprint: preview.fingerprint, periodId, date, accountMapping: mapping,
  }) as AnyRecord;
  const voucher = imported.voucher as AnyRecord;
  assert(voucher.id, `${kind} 凭证草稿应生成`);
  await mutateFinanceLedger(approverScope, { action: 'review-voucher', voucherId: voucher.id, revision: voucher.revision });
  const reviewed = await prisma.financeVoucher.findUniqueOrThrow({ where: { id: voucher.id as string } });
  await mutateFinanceLedger(approverScope, { action: 'post-voucher', voucherId: voucher.id, revision: reviewed.revision });
  const posted = await prisma.financeVoucher.findUniqueOrThrow({ where: { id: voucher.id as string } });
  assert(posted.status === 'POSTED', `${kind} 凭证应已过账`);
  console.log(`  ${kind} → 凭证 ${posted.number ?? posted.id}：${lines.length} 条分录已过账`);
  return posted;
}

async function finance(draftId: string, invoiceId: string, paymentId: string, orderId: string, book: Awaited<ReturnType<typeof ledger>>) {
  step('核算来源交接 → 凭证复核过账');
  const { bookId, periodId, subjects } = book;
  const receiptVoucher = await importAndPost('WMS_COMMAND', draftId,
    { ACC_INVENTORY: subjects.inventory, ACC_PAYABLE: subjects.payable }, subjects, periodId, '2026-11-10');
  const invoiceVoucher = await importAndPost('PURCHASE_INVOICE', invoiceId,
    { PURCHASE_INVOICE_COST: subjects.inventory, PURCHASE_INPUT_VAT: subjects.vat, PURCHASE_PAYABLE: subjects.payable }, subjects, periodId, '2026-11-10');
  const paymentVoucher = await importAndPost('PURCHASE_PAYMENT', paymentId,
    { PURCHASE_PAYABLE: subjects.payable, PURCHASE_CASH_BANK: subjects.cash }, subjects, periodId, '2026-11-12');

  step('应付往来登记 → 付款核销');
  const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
  const register = async (voucher: Awaited<ReturnType<typeof importAndPost>>, subjectId: string, evidence: string) => {
    const result = await mutateFinanceOpenItems(scope, {
      action: 'confirm-purchase', bookId, voucherId: voucher.id, subjectId,
      purchaseOrderId: orderId, orderRevision: order.revision, voucherRevision: voucher.revision,
      dueDate: '2026-12-10', evidence,
    }) as AnyRecord;
    const item = result.item as AnyRecord;
    assert(item.id, '往来项应登记');
    return item;
  };
  const payable = await register(receiptVoucher, subjects.payable, '收货计价确认应付');
  const paid = await register(paymentVoucher, subjects.payable, '付款登记');
  assert(Number(payable.amount) === 1000, `应付应为 1000，实际 ${payable.amount}`);
  assert(Number(paid.amount) === 1000, `已付应为 1000，实际 ${paid.amount}`);
  const settled = await mutateFinanceOpenItems(scope, {
    action: 'settle', bookId, documentId: payable.id, paymentId: paid.id,
    documentRevision: payable.revision, paymentRevision: paid.revision, periodId, date: '2026-11-12',
    amount: '1000.000000', idempotencyKey: `${PREFIX}settle-${RUN}`, evidence: '验收核销',
  }) as AnyRecord;
  assert(settled.settlement, '应生成核销记录');
  console.log(`  应付 1000 / 已付 1000 → 核销 1000 完成，发票凭证 ${invoiceVoucher.id} 已入账`);
}

async function main() {
  if (RESET) { console.log('清理既有验收数据…'); await reset(); }
  const existing = IN_PLACE ? null : await prisma.organization.findUnique({ where: { id: ORG } });
  if (existing) { console.error(`组织 ${ORG} 已存在；换一个 ACC_ORG 或直接不传 --reset 重跑`); process.exit(1); }
  const master = await bootstrap();
  const { orderId, orderRevision } = await planToOrder(master.productId);
  const placedRevision = await approveAndPlace(orderId, orderRevision);
  const rec = await receive(orderId, placedRevision, master.receivingId, master.storageId);
  const draftId = await valuation(rec.commandId);
  const inv = await invoice(orderId);
  const paymentId = await payment(orderId);
  const book = await ledger();
  await finance(draftId, inv.invoiceId, paymentId, orderId, book);
  console.log(`\n验收演练通过：${checks} 项断言，数据保留在组织 ${ORG}（工作区 ${WS}）。`);
  console.log('单据：采购计划 / 采购单 / 收货单 / 计价草稿 / 发票 / 付款 / 三张已过账凭证 / 应付往来 / 核销记录。');
  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(`\n验收演练失败于【${stage}】：`, error instanceof Error ? error.message : error);
  console.error('提示：修复后加 --reset 重跑即可清理本组织的残留数据。');
  await prisma.$disconnect();
  process.exit(1);
});
