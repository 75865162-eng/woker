import { createHash } from 'node:crypto';
import { WmsError } from '@/lib/wms/contracts';

/**
 * 采购发票三单匹配规则（纯函数，不碰数据库）。
 *
 * 三单：采购订单（承诺买多少） / 收货单（实际验收多少） / 发票（供应商要收多少钱）。
 * 只有「已验收数量」才是可开票的依据；订单数量只是上限。差异不自动放行，
 * 必须带理由提交审批，且申请人不能自批。
 */

const SCALE = BigInt(1_000_000);

export const purchaseInvoiceStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'VOID'] as const;
export type PurchaseInvoiceStatus = (typeof purchaseInvoiceStatuses)[number];

export const invoiceStatusLabels: Record<PurchaseInvoiceStatus, string> = {
  DRAFT: '草稿',
  PENDING_APPROVAL: '待审批',
  APPROVED: '已核准',
  VOID: '已作废',
};

export const matchStatusLabels: Record<'PENDING' | 'MATCHED' | 'EXCEPTION', string> = {
  PENDING: '待匹配',
  MATCHED: '三单一致',
  EXCEPTION: '存在差异',
};

export const exceptionLabels: Record<string, string> = {
  NO_ORDER_LINE: '发票品项不在采购单内',
  NO_RECEIPT: '尚未收货',
  QTY_OVER_ORDER: '开票数量超订单数量',
  QTY_OVER_RECEIPT: '开票数量超已验收数量',
  PRICE_VARIANCE: '单价超出容差',
  AMOUNT_MISMATCH: '行金额与数量×单价不符',
  CUMULATIVE_OVER_RECEIPT: '累计开票超已验收数量',
};

/** 金额一律用 6 位小数定点整数计算，不做浮点运算。 */
export function amountUnits(value: string): bigint | null {
  const text = String(value ?? '').trim();
  if (!/^[0-9]{1,14}([.][0-9]{1,6})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}

export function amountText(units: bigint): string {
  const negative = units < 0;
  const absolute = negative ? -units : units;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${absolute / SCALE}.${fraction}`;
}

export type InvoiceLineInput = { productRecordId: string; invoicedQty: number; unitPrice: string; amount?: string; taxAmount?: string; notes?: string };
export type InvoiceDraft = {
  number: string;
  supplierInvoiceNo: string;
  purchaseOrderId: string;
  invoiceDate: Date;
  dueDate: Date | null;
  qtyToleranceBp: number;
  priceToleranceBp: number;
  amountTolerance: string;
  overrideReason: string;
  notes: string;
  lines: InvoiceLineInput[];
};

const maxBp = 10000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value: unknown, label: string): Date {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!datePattern.test(text)) throw new WmsError(`${label}须为 YYYY-MM-DD。`, 400);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new WmsError(`${label}不是有效日期。`, 400);
  return parsed;
}

function requireBp(value: unknown, fallback: number, label: string) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxBp) throw new WmsError(`${label}须为 0 到 10000 之间的整数（万分之一）。`, 400);
  return parsed;
}

export function parseInvoiceDraft(body: Record<string, unknown>): InvoiceDraft {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const number = text(body.number);
  if (number.length < 1 || number.length > 80) throw new WmsError('发票编号须为 1 到 80 个字符。', 400);
  const supplierInvoiceNo = text(body.supplierInvoiceNo);
  if (supplierInvoiceNo.length < 1 || supplierInvoiceNo.length > 80) throw new WmsError('供应商发票号须为 1 到 80 个字符。', 400);
  const purchaseOrderId = text(body.purchaseOrderId);
  if (!purchaseOrderId) throw new WmsError('请选择采购订单。', 400);
  const invoiceDate = requireDate(body.invoiceDate, '开票日期');
  const dueDate = body.dueDate ? requireDate(body.dueDate, '到期日期') : null;
  if (dueDate && dueDate.getTime() < invoiceDate.getTime()) throw new WmsError('到期日期不能早于开票日期。', 400);
  const amountToleranceText = text(body.amountTolerance) || '0';
  if (amountUnits(amountToleranceText) === null) throw new WmsError('金额容差须为非负十进制数，最多 6 位小数。', 400);
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw new WmsError('发票至少需要一行明细。', 400);
  if (rawLines.length > 200) throw new WmsError('单张发票最多 200 行明细。', 400);
  const seen = new Set<string>();
  const lines: InvoiceLineInput[] = rawLines.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const productRecordId = text(row.productRecordId);
    if (!productRecordId) throw new WmsError(`第 ${index + 1} 行缺少商品。`, 400);
    if (seen.has(productRecordId)) throw new WmsError(`第 ${index + 1} 行商品重复，同一商品请合并为一行。`, 400);
    seen.add(productRecordId);
    const invoicedQty = Number(row.invoicedQty);
    if (!Number.isInteger(invoicedQty) || invoicedQty <= 0 || invoicedQty > 2147483647) throw new WmsError(`第 ${index + 1} 行开票数量须为正整数。`, 400);
    const unitPrice = text(row.unitPrice);
    if (amountUnits(unitPrice) === null) throw new WmsError(`第 ${index + 1} 行单价须为非负十进制数，最多 6 位小数。`, 400);
    const taxAmount = text(row.taxAmount) || '0';
    if (amountUnits(taxAmount) === null) throw new WmsError(`第 ${index + 1} 行税额须为非负十进制数。`, 400);
    const declared = text(row.amount);
    if (declared && amountUnits(declared) === null) throw new WmsError(`第 ${index + 1} 行金额须为非负十进制数。`, 400);
    return { productRecordId, invoicedQty, unitPrice, taxAmount, amount: declared || undefined, notes: text(row.notes).slice(0, 500) };
  });
  return {
    number,
    supplierInvoiceNo,
    purchaseOrderId,
    invoiceDate,
    dueDate,
    qtyToleranceBp: requireBp(body.qtyToleranceBp, 0, '数量容差'),
    priceToleranceBp: requireBp(body.priceToleranceBp, 50, '单价容差'),
    amountTolerance: amountToleranceText,
    overrideReason: text(body.overrideReason).slice(0, 500),
    notes: text(body.notes).slice(0, 1000),
    lines,
  };
}

export type OrderLineSnapshot = { productRecordId: string; expectedQty: number; unitPrice: string };
export type MatchLineResult = {
  productRecordId: string;
  orderedQty: number;
  receivedQty: number;
  invoicedQty: number;
  poUnitPrice: string;
  unitPrice: string;
  amount: string;
  taxAmount: string;
  varianceQty: number;
  varianceAmount: string;
  exceptionCodes: string[];
};

export type MatchResult = {
  matchStatus: 'MATCHED' | 'EXCEPTION';
  exceptionSummary: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  lines: MatchLineResult[];
};

/**
 * 逐行比对：
 * 1. 品项必须来自采购单（否则 NO_ORDER_LINE，直接阻断）；
 * 2. 开票数量不得超过「已验收数量 ×（1 + 数量容差）」，超出记 QTY_OVER_RECEIPT；超过订单数量再记 QTY_OVER_ORDER；
 * 3. 累计开票（含历史有效发票）同样不得超过已验收数量，防止分次开票绕过；
 * 4. 单价与订单单价差异超过容差记 PRICE_VARIANCE；
 * 5. 行金额必须等于数量×单价（容差内），否则 AMOUNT_MISMATCH。
 * 差异不阻断保存，但会阻断「无理由提交审批」。
 */
export function matchInvoice(input: {
  orderLines: OrderLineSnapshot[];
  receivedByProduct: Map<string, number>;
  priorInvoicedByProduct: Map<string, number>;
  invoiceLines: InvoiceLineInput[];
  qtyToleranceBp: number;
  priceToleranceBp: number;
  amountTolerance: string;
}): MatchResult {
  const orderByProduct = new Map(input.orderLines.map(line => [line.productRecordId, line]));
  const amountTolerance = amountUnits(input.amountTolerance) ?? BigInt(0);
  const lines: MatchLineResult[] = [];
  let subtotal = BigInt(0);
  let taxTotal = BigInt(0);
  let exceptionLines = 0;

  for (const line of input.invoiceLines) {
    const order = orderByProduct.get(line.productRecordId);
    if (!order) throw new WmsError('发票明细包含采购单以外的商品，请先核对采购订单。', 422);
    const receivedQty = Math.max(0, input.receivedByProduct.get(line.productRecordId) ?? 0);
    const priorQty = Math.max(0, input.priorInvoicedByProduct.get(line.productRecordId) ?? 0);
    const unitPriceUnits = amountUnits(line.unitPrice);
    const poPriceUnits = amountUnits(order.unitPrice);
    if (unitPriceUnits === null || poPriceUnits === null) throw new WmsError('单价格式无效。', 400);
    const taxUnits = amountUnits(line.taxAmount ?? '0') ?? BigInt(0);
    const poAmount = poPriceUnits * BigInt(receivedQty);
    const codes: string[] = [];

    if (receivedQty === 0) codes.push('NO_RECEIPT');
    if (BigInt(line.invoicedQty) * BigInt(10000) > BigInt(receivedQty) * BigInt(10000 + input.qtyToleranceBp)) codes.push('QTY_OVER_RECEIPT');
    if (line.invoicedQty > order.expectedQty) codes.push('QTY_OVER_ORDER');
    if (BigInt(line.invoicedQty + priorQty) * BigInt(10000) > BigInt(receivedQty) * BigInt(10000 + input.qtyToleranceBp)) codes.push('CUMULATIVE_OVER_RECEIPT');
    if (unitPriceUnits !== poPriceUnits) {
      const diff = unitPriceUnits > poPriceUnits ? unitPriceUnits - poPriceUnits : poPriceUnits - unitPriceUnits;
      if (diff * BigInt(10000) > poPriceUnits * BigInt(input.priceToleranceBp)) codes.push('PRICE_VARIANCE');
    }
    const expectedAmount = unitPriceUnits * BigInt(line.invoicedQty);
    // 发票票面金额优先（供应商可能按含税或四舍五入出票），与数量×单价不符时按容差判定
    const declaredUnits = line.amount ? amountUnits(line.amount) : null;
    const declaredAmount = declaredUnits === null ? expectedAmount : declaredUnits;
    if (declaredAmount > expectedAmount + amountTolerance || declaredAmount + amountTolerance < expectedAmount) codes.push('AMOUNT_MISMATCH');

    subtotal += declaredAmount;
    taxTotal += taxUnits;
    if (codes.length) exceptionLines++;
    lines.push({
      productRecordId: line.productRecordId,
      orderedQty: order.expectedQty,
      receivedQty,
      invoicedQty: line.invoicedQty,
      poUnitPrice: order.unitPrice,
      unitPrice: line.unitPrice,
      amount: amountText(declaredAmount),
      taxAmount: amountText(taxUnits),
      varianceQty: line.invoicedQty - receivedQty,
      varianceAmount: amountText(declaredAmount - poAmount),
      exceptionCodes: codes,
    });
  }

  const codes = new Set(lines.flatMap(line => line.exceptionCodes));
  const parts = [...codes].map(code => `${exceptionLabels[code] ?? code} ${lines.filter(line => line.exceptionCodes.includes(code)).length} 行`);
  return {
    matchStatus: exceptionLines === 0 ? 'MATCHED' : 'EXCEPTION',
    exceptionSummary: exceptionLines === 0 ? '' : `${exceptionLines} 行差异：${parts.join('、')}`,
    subtotal: amountText(subtotal),
    taxAmount: amountText(taxTotal),
    totalAmount: amountText(subtotal + taxTotal),
    lines,
  };
}

export function invoiceHash(invoice: {
  number: string;
  supplierInvoiceNo: string;
  purchaseOrderId: string;
  invoiceDate: Date;
  dueDate: Date | null;
  currency: string;
  qtyToleranceBp: number;
  priceToleranceBp: number;
  amountTolerance: { toString(): string } | string;
  overrideReason: string;
  notes: string;
  lines: Array<{ productRecordId: string; invoicedQty: number; unitPrice: { toString(): string } | string; taxAmount: { toString(): string } | string; notes: string }>;
}) {
  const body = {
    number: invoice.number,
    supplierInvoiceNo: invoice.supplierInvoiceNo,
    purchaseOrderId: invoice.purchaseOrderId,
    invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null,
    currency: invoice.currency,
    qtyToleranceBp: invoice.qtyToleranceBp,
    priceToleranceBp: invoice.priceToleranceBp,
    amountTolerance: String(invoice.amountTolerance),
    overrideReason: invoice.overrideReason,
    notes: invoice.notes,
    lines: [...invoice.lines]
      .sort((a, b) => a.productRecordId.localeCompare(b.productRecordId))
      .map(line => ({ productRecordId: line.productRecordId, invoicedQty: line.invoicedQty, unitPrice: String(line.unitPrice), taxAmount: String(line.taxAmount), notes: line.notes })),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/** 差异发票必须带理由才能提交审批；一致发票不需要。 */
export function assertInvoiceSubmittable(input: { status: string; matchStatus: string; overrideReason: string }) {
  if (input.status !== 'DRAFT') throw new WmsError('仅草稿发票可以提交审批。', 409);
  if (input.matchStatus === 'PENDING') throw new WmsError('请先完成三单匹配。', 409);
  if (input.matchStatus === 'EXCEPTION' && !input.overrideReason.trim()) throw new WmsError('存在三单差异，须填写差异放行理由后才能提交审批。', 422);
}
