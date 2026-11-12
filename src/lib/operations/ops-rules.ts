import { createHash } from 'node:crypto';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireText, strictKeys } from '@/lib/wms/rules';

export type CarrierDraft = {
  code: string; name: string; serviceLevel: string; contactName: string;
  trackingUrlPattern: string; enabled: boolean; notes: string;
};
export type WarehouseDraft = {
  code: string; name: string; provider: string; accountRef: string;
  region: string; status: string; enabled: boolean; notes: string;
};
export type UnsalableInput = {
  sku: string; productRecordId: string; onHand: number; ageDays: number; salesQty: number;
};
export type UnsalablePolicy = { slowDays: number; minSalesQty: number; salesWindowDays: number };
export type UnsalableRow = UnsalableInput & { level: 'NORMAL' | 'SLOW' | 'UNSALABLE'; action: string };

const optional = (value: unknown, label: string, max: number) => {
  if (value === undefined || value === null || value === '') return '';
  return requireText(value, label, max);
};

export function parseCarrierDraft(body: Record<string, unknown>): CarrierDraft {
  strictKeys(body, ['action', 'id', 'revision', 'code', 'name', 'serviceLevel', 'contactName', 'trackingUrlPattern', 'enabled', 'notes']);
  const code = requireText(body.code, '承运商编码', 40).toUpperCase();
  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) throw new WmsError('承运商编码仅允许大写字母、数字、下划线与连字符。', 400);
  if (typeof body.enabled !== 'boolean') throw new WmsError('启用状态须为布尔值。', 400);
  const pattern = optional(body.trackingUrlPattern, '轨迹查询模板', 300);
  if (pattern && !/^https:\/\/[^\s]+$/.test(pattern)) throw new WmsError('轨迹查询模板须为 HTTPS 地址，并用 {trackingNo} 占位。', 400);
  return {
    code,
    name: requireText(body.name, '承运商名称', 120),
    serviceLevel: optional(body.serviceLevel, '时效等级', 60),
    contactName: optional(body.contactName, '联系人', 80),
    trackingUrlPattern: pattern,
    enabled: body.enabled,
    notes: optional(body.notes, '备注', 500),
  };
}

export function parseWarehouseDraft(body: Record<string, unknown>): WarehouseDraft {
  strictKeys(body, ['action', 'id', 'revision', 'code', 'name', 'provider', 'accountRef', 'region', 'status', 'enabled', 'notes']);
  const code = requireText(body.code, '三方仓编码', 40).toUpperCase();
  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) throw new WmsError('三方仓编码仅允许大写字母、数字、下划线与连字符。', 400);
  const status = requireText(body.status ?? 'ACTIVE', '账户状态', 20).toUpperCase();
  if (!['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(status)) throw new WmsError('账户状态无效。', 400);
  if (typeof body.enabled !== 'boolean') throw new WmsError('启用状态须为布尔值。', 400);
  return {
    code,
    name: requireText(body.name, '仓库名称', 120),
    provider: requireText(body.provider, '服务商', 120),
    accountRef: optional(body.accountRef, '对接账户', 120),
    region: optional(body.region, '区域', 80),
    status,
    enabled: body.enabled,
    notes: optional(body.notes, '备注', 500),
  };
}

/** 滞销口径：库龄超阈值且窗口销量低于下限判滞销；只满足其一判慢动，均不满足为正常。 */
export function classifyUnsalable(row: UnsalableInput, policy: UnsalablePolicy): UnsalableRow {
  const aged = row.ageDays >= policy.slowDays;
  const quiet = row.salesQty <= policy.minSalesQty;
  const level = aged && quiet ? 'UNSALABLE' : aged || quiet ? 'SLOW' : 'NORMAL';
  const action = level === 'UNSALABLE' ? '停止补货并安排清仓或调拨' : level === 'SLOW' ? '促销或降价观察一个窗口' : '正常周转';
  return { ...row, level, action };
}

/** 只保留有库存的 SKU，按滞销程度与占压数量排序，保证快照稳定可复现。 */
export function unsalableRows(rows: readonly UnsalableInput[], policy: UnsalablePolicy): UnsalableRow[] {
  const weight = { UNSALABLE: 0, SLOW: 1, NORMAL: 2 };
  return rows
    .filter(row => row.onHand > 0)
    .map(row => classifyUnsalable(row, policy))
    .sort((a, b) => weight[a.level] - weight[b.level] || b.onHand - a.onHand || a.sku.localeCompare(b.sku));
}

export function unsalableFingerprint(rows: readonly UnsalableRow[], policy: UnsalablePolicy, identity: Pick<WmsScope, 'organizationId' | 'workspaceId'> & { warehouseId: string; asOfDate: string }) {
  return createHash('sha256').update(JSON.stringify({
    organizationId: identity.organizationId, workspaceId: identity.workspaceId,
    warehouseId: identity.warehouseId, asOfDate: identity.asOfDate,
    policy, rows,
  })).digest('hex');
}

export function parseUnsalablePolicy(body: Record<string, unknown>): UnsalablePolicy {
  strictKeys(body, ['action', 'warehouseId', 'asOfDate', 'policyReference', 'slowDays', 'minSalesQty', 'salesWindowDays']);
  const bounded = (value: unknown, label: string, min: number, max: number) => {
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new WmsError(`${label}须为 ${min}-${max} 的整数。`, 400);
    return Number(value);
  };
  return {
    slowDays: bounded(body.slowDays ?? 90, '库龄阈值', 1, 3650),
    minSalesQty: bounded(body.minSalesQty ?? 0, '窗口销量下限', 0, 1_000_000),
    salesWindowDays: bounded(body.salesWindowDays ?? 90, '销量窗口', 1, 365),
  };
}
