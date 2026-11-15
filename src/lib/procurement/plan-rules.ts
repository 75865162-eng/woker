import { createHash } from 'node:crypto';
import { requirePositiveQuantity, requireText, strictKeys, WmsInputError } from '@/lib/wms/rules';

/**
 * 采购计划把"需求推算"和"人工确认"分开：
 * 系统只给建议数量（suggestedQty），最终下单量（plannedQty）必须人工填。
 * 计划单据本身不预占库存、不产生出入库流水，转成采购单后才进入原有审批与收货链路。
 */
export const purchasePlanStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CONVERTED', 'CANCELLED'] as const;
export type PurchasePlanStatus = (typeof purchasePlanStatuses)[number];

export const purchasePlanStatusLabels: Record<PurchasePlanStatus, string> = {
  DRAFT: '草稿',
  PENDING_APPROVAL: '待审批',
  APPROVED: '已批准',
  CONVERTED: '已转采购单',
  CANCELLED: '已作废',
};

const planBounds = { salesWindowDays: [1, 365], coverageDays: [1, 365], safetyDays: [0, 365] } as const;

function requireBoundedInt(value: unknown, label: string, fallback: number, [minimum, maximum]: readonly [number, number]) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new WmsInputError(`${label}须为 ${minimum}-${maximum} 之间的整数。`);
  }
  return parsed;
}

function requireDateText(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new WmsInputError(`${label}须为 YYYY-MM-DD 日期。`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new WmsInputError(`${label}不是有效日期。`);
  return parsed;
}

function optionalText(value: unknown, label: string, maximum: number) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum) throw new WmsInputError(`${label}格式或长度无效。`);
  return value.trim();
}

/**
 * 缺口 = 覆盖期内的目标库存 - 现有供给。
 * 供给只算「真正能用的」：公司仓可用数量（已扣预占）+ 在途（未收采购 + 调拨在途 + FBA 在途由调用方合并进 inboundQty）。
 * 销量用固定窗口的净销量（扣退款），避免用单月峰值把库存推爆。
 */
export function suggestPurchaseQty(input: { availableQty: number; inboundQty: number; salesQty: number; salesWindowDays: number; coverageDays: number; safetyDays: number }) {
  const { availableQty, inboundQty, salesQty, salesWindowDays, coverageDays, safetyDays } = input;
  if (salesWindowDays <= 0) return 0;
  const dailySales = salesQty / salesWindowDays;
  if (dailySales <= 0) return 0;
  const target = Math.ceil(dailySales * (coverageDays + safetyDays));
  const gap = target - Math.max(0, availableQty) - Math.max(0, inboundQty);
  return gap > 0 ? gap : 0;
}

export type PurchasePlanLineDraft = {
  productRecordId: string;
  plannedQty: number;
  unitPrice: string;
  notes: string;
  onHandQty: number;
  inboundQty: number;
  salesQty: number;
  suggestedQty: number;
};

export type PurchasePlanDraft = {
  number: string;
  supplierId: string | null;
  periodStart: Date;
  periodEnd: Date;
  salesWindowDays: number;
  coverageDays: number;
  safetyDays: number;
  notes: string;
  lines: PurchasePlanLineDraft[];
};

/** 计划草稿契约。金额保持十进制文本，避免浮点误差进入采购单价。 */
export function parsePurchasePlanDraft(body: Record<string, unknown>): PurchasePlanDraft {
  strictKeys(body, ['action', 'id', 'revision', 'number', 'supplierId', 'periodStart', 'periodEnd', 'salesWindowDays', 'coverageDays', 'safetyDays', 'notes', 'lines']);
  const number = requireText(body.number, '计划单号', 80);
  const supplierId = body.supplierId === undefined || body.supplierId === null || body.supplierId === '' ? null : requireText(body.supplierId, '供应商', 120);
  const periodStart = requireDateText(body.periodStart, '计划期开始');
  const periodEnd = requireDateText(body.periodEnd, '计划期结束');
  if (periodEnd.getTime() < periodStart.getTime()) throw new WmsInputError('计划期结束不能早于开始。');
  const salesWindowDays = requireBoundedInt(body.salesWindowDays, '销量窗口天数', 90, planBounds.salesWindowDays);
  const coverageDays = requireBoundedInt(body.coverageDays, '覆盖天数', 60, planBounds.coverageDays);
  const safetyDays = requireBoundedInt(body.safetyDays, '安全天数', 15, planBounds.safetyDays);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 200) throw new WmsInputError('计划明细须为 1-200 行。');
  const lines = body.lines.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsInputError('计划明细格式无效。');
    const line = raw as Record<string, unknown>;
    strictKeys(line, ['productRecordId', 'plannedQty', 'unitPrice', 'notes', 'onHandQty', 'inboundQty', 'salesQty', 'suggestedQty']);
    if (typeof line.unitPrice !== 'string' || !/^\d{1,14}(\.\d{1,6})?$/.test(line.unitPrice)) throw new WmsInputError('单价须为最多六位小数的非负金额文本。');
    const snapshot = (value: unknown) => requireBoundedInt(value, '推算快照', 0, [0, 2_147_483_647]);
    return {
      productRecordId: requireText(line.productRecordId, '采购商品', 120),
      plannedQty: requirePositiveQuantity(line.plannedQty, '计划数量'),
      unitPrice: line.unitPrice,
      notes: optionalText(line.notes, '明细备注', 500),
      onHandQty: snapshot(line.onHandQty),
      inboundQty: snapshot(line.inboundQty),
      salesQty: snapshot(line.salesQty),
      suggestedQty: snapshot(line.suggestedQty),
    } satisfies PurchasePlanLineDraft;
  });
  if (new Set(lines.map(line => line.productRecordId)).size !== lines.length) throw new WmsInputError('同一计划内商品不能重复，请合并数量。');
  return { number, supplierId, periodStart, periodEnd, salesWindowDays, coverageDays, safetyDays, notes: optionalText(body.notes, '计划备注', 1000), lines };
}

/** 审批指纹只覆盖"会改变采购承诺"的字段，避免备注排版变化导致审批失效。 */
export function purchasePlanHash(plan: { number: string; supplierId: string | null; periodStart: Date; periodEnd: Date; lines: Array<{ productRecordId: string; plannedQty: number; unitPrice: string }> }) {
  const body = {
    number: plan.number,
    supplierId: plan.supplierId,
    periodStart: plan.periodStart.toISOString().slice(0, 10),
    periodEnd: plan.periodEnd.toISOString().slice(0, 10),
    lines: [...plan.lines]
      .sort((left, right) => left.productRecordId.localeCompare(right.productRecordId))
      .map(line => ({ productRecordId: line.productRecordId, plannedQty: line.plannedQty, unitPrice: line.unitPrice })),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/** 计划只能整体转出一次；部分转出会让"已转采购单"状态失去意义。 */
export function assertPlanConvertible(status: string, convertedOrderId: string | null) {
  if (convertedOrderId) throw new WmsInputError('该计划已转采购单，不能重复转换。');
  if (status !== 'APPROVED') throw new WmsInputError('只有已批准的计划可以转采购单。');
}

/**
 * 商品查询条件必须只含组织/工作区（以及可选的指定商品），
 * 不能把 actorUserId 等上下文字段原样展开进 Prisma where，否则整条需求推算会直接报错。
 */
export function planProductWhere(scope: { organizationId: string; workspaceId: string }, ids?: string[]) {
  const where: { organizationId: string; workspaceId: string; id?: { in: string[] } } = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  };
  if (ids?.length) where.id = { in: ids };
  return where;
}
