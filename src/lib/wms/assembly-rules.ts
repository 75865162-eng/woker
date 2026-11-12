import { requirePositiveQuantity, requireText, strictKeys } from './rules';
import { WmsError, type WmsScope } from './contracts';

/**
 * 组装规则（纯函数）。
 * 关键立场：组装单草稿不预占库存；只有完成命令才扣组件、产成品。
 * 组件成本按「快照单价 × 实际耗用」累加，产成品单位成本 = 总成本 / 实际产出。
 */

export type BomLineDraft = { componentProductRecordId: string; quantityPer: number; notes: string };
export type BomDraft = { productRecordId: string; version: string; notes: string; lines: BomLineDraft[] };

export type AssemblyLineOverride = { componentProductRecordId: string; quantity: number };

export type AssemblyDraft = {
  number: string;
  productRecordId: string;
  bomId: string | null;
  warehouseId: string;
  locationId: string;
  lotId: string | null;
  plannedQty: number;
  currency: string;
  notes: string;
  idempotencyKey: string;
  overrides: AssemblyLineOverride[];
};

export type AllocationCandidate = {
  balanceId: string;
  productRecordId: string;
  lotId: string;
  locationId: string;
  warehouseId: string;
  available: number;
  createdAt: Date;
};

export type AllocatedLine = {
  balanceId: string;
  componentProductRecordId: string;
  lotId: string;
  locationId: string;
  warehouseId: string;
  plannedQty: number;
};

export const ASSEMBLY_LIMITS = { maxBomLines: 50, maxPlannedQty: 100000 } as const;

export function parseBomDraft(raw: unknown): BomDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsError('BOM 内容无效。', 400);
  const value = raw as Record<string, unknown>;
  strictKeys(value, ['productRecordId', 'version', 'notes', 'lines']);
  const productRecordId = requireText(value.productRecordId, '成品商品', 100);
  const version = value.version === undefined ? 'V1' : requireText(value.version, '版本', 40);
  const notes = value.notes === undefined ? '' : requireText(value.notes, '备注', 500);
  if (!Array.isArray(value.lines) || !value.lines.length || value.lines.length > ASSEMBLY_LIMITS.maxBomLines) {
    throw new WmsError(`BOM 组件须为 1-${ASSEMBLY_LIMITS.maxBomLines} 行。`, 400);
  }
  const seen = new Set<string>();
  const lines = value.lines.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new WmsError(`第 ${index + 1} 行组件无效。`, 400);
    const line = row as Record<string, unknown>;
    strictKeys(line, ['componentProductRecordId', 'quantityPer', 'notes']);
    const componentProductRecordId = requireText(line.componentProductRecordId, '组件商品', 100);
    if (componentProductRecordId === productRecordId) throw new WmsError('成品不能作为自己的组件。', 422);
    if (seen.has(componentProductRecordId)) throw new WmsError(`第 ${index + 1} 行组件重复。`, 422);
    seen.add(componentProductRecordId);
    const quantityPer = requirePositiveQuantity(line.quantityPer, '单位用量');
    if (quantityPer > ASSEMBLY_LIMITS.maxPlannedQty) throw new WmsError('单位用量超出上限。', 422);
    return { componentProductRecordId, quantityPer, notes: line.notes === undefined ? '' : requireText(line.notes, '行备注', 200) };
  });
  return { productRecordId, version, notes, lines };
}

export function parseAssemblyDraft(raw: unknown): AssemblyDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsError('组装单内容无效。', 400);
  const value = raw as Record<string, unknown>;
  strictKeys(value, ['number', 'productRecordId', 'bomId', 'warehouseId', 'locationId', 'lotId', 'plannedQty', 'currency', 'notes', 'idempotencyKey', 'overrides']);
  const plannedQty = requirePositiveQuantity(value.plannedQty, '计划产量');
  if (plannedQty > ASSEMBLY_LIMITS.maxPlannedQty) throw new WmsError('计划产量超出上限。', 422);
  const currency = value.currency === undefined ? 'CNY' : requireText(value.currency, '币种', 10).toUpperCase();
  const overridesRaw = value.overrides ?? [];
  if (!Array.isArray(overridesRaw)) throw new WmsError('组件调整须为数组。', 400);
  const seen = new Set<string>();
  const overrides = overridesRaw.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new WmsError(`第 ${index + 1} 行组件调整无效。`, 400);
    const item = row as Record<string, unknown>;
    strictKeys(item, ['componentProductRecordId', 'quantity']);
    const componentProductRecordId = requireText(item.componentProductRecordId, '组件商品', 100);
    if (seen.has(componentProductRecordId)) throw new WmsError(`第 ${index + 1} 行组件调整重复。`, 422);
    seen.add(componentProductRecordId);
    return { componentProductRecordId, quantity: requirePositiveQuantity(item.quantity, '组件数量') };
  });
  return {
    number: requireText(value.number, '组装单号', 80),
    productRecordId: requireText(value.productRecordId, '成品商品', 100),
    bomId: value.bomId === undefined || value.bomId === null || value.bomId === '' ? null : requireText(value.bomId, 'BOM', 100),
    warehouseId: requireText(value.warehouseId, '仓库', 100),
    locationId: requireText(value.locationId, '成品库位', 100),
    lotId: value.lotId === undefined || value.lotId === null || value.lotId === '' ? null : requireText(value.lotId, '成品批次', 100),
    plannedQty,
    currency,
    notes: value.notes === undefined ? '' : requireText(value.notes, '备注', 1000),
    idempotencyKey: requireText(value.idempotencyKey, '幂等键', 120),
    overrides,
  };
}

/** BOM 展开：计划产量 × 单位用量，再应用人工调整（调整优先，必须为正整数）。 */
export function expandComponents(bom: Array<{ componentProductRecordId: string; quantityPer: number }>, plannedQty: number, overrides: AssemblyLineOverride[] = []) {
  const overrideMap = new Map(overrides.map(row => [row.componentProductRecordId, row.quantity]));
  for (const key of overrideMap.keys()) {
    if (!bom.some(line => line.componentProductRecordId === key)) throw new WmsError('组件调整包含 BOM 之外的物料。', 422);
  }
  const demand = new Map<string, number>();
  for (const line of bom) {
    const quantity = overrideMap.get(line.componentProductRecordId) ?? line.quantityPer * plannedQty;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new WmsError('组件需求量越界。', 422);
    demand.set(line.componentProductRecordId, (demand.get(line.componentProductRecordId) ?? 0) + quantity);
  }
  return [...demand.entries()].map(([componentProductRecordId, quantity]) => ({ componentProductRecordId, quantity }))
    .sort((left, right) => left.componentProductRecordId.localeCompare(right.componentProductRecordId));
}

/**
 * 组件分配（FIFO）：按批次入库时间先后，从同仓库可用余额中取料。
 * 任一组件不足即整体拒绝——组装缺一个件就出不了货，不能先扣一半。
 */
export function allocateComponents(demand: Array<{ componentProductRecordId: string; quantity: number }>, candidates: AllocationCandidate[], warehouseId: string) {
  const ordered = [...candidates]
    .filter(row => row.warehouseId === warehouseId && row.available > 0)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.balanceId.localeCompare(right.balanceId));
  const lines: AllocatedLine[] = [];
  const shortages: Array<{ componentProductRecordId: string; required: number; available: number }> = [];
  for (const need of demand) {
    const pool = ordered.filter(row => row.productRecordId === need.componentProductRecordId);
    const total = pool.reduce((sum, row) => sum + row.available, 0);
    if (total < need.quantity) {
      shortages.push({ componentProductRecordId: need.componentProductRecordId, required: need.quantity, available: total });
      continue;
    }
    let remaining = need.quantity;
    for (const row of pool) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, row.available);
      lines.push({
        balanceId: row.balanceId,
        componentProductRecordId: need.componentProductRecordId,
        lotId: row.lotId,
        locationId: row.locationId,
        warehouseId: row.warehouseId,
        plannedQty: take,
      });
      remaining -= take;
    }
  }
  return { lines, shortages };
}

export function shortageMessage(shortages: Array<{ componentProductRecordId: string; required: number; available: number }>) {
  if (!shortages.length) return '';
  return `组件库存不足：${shortages.map(row => `${row.componentProductRecordId} 需 ${row.required} 可用 ${row.available}`).join('；')}`;
}

export const ASSEMBLY_SCALE = 1_000_000n;

export function scaleCost(value: string | number): bigint {
  const text = typeof value === 'number' ? value.toFixed(6) : value.trim();
  if (!/^-?\d+(\.\d{1,6})?$/.test(text)) throw new WmsError('成本数值无效。', 400);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const units = BigInt(whole) * ASSEMBLY_SCALE + BigInt((fraction + '000000').slice(0, 6));
  return negative ? -units : units;
}

export function formatCost(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / ASSEMBLY_SCALE;
  const fraction = (abs % ASSEMBLY_SCALE).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** 行金额 = 耗用量 × 单价，单位成本按四舍五入保留 6 位。 */
export function lineAmount(quantity: number, unitCost: string): string {
  return formatCost(scaleCost(unitCost) * BigInt(quantity));
}

/** 产成品单位成本 = 组件总成本 / 实际产出，四舍五入到 6 位（half-up）。 */
export function rolledUnitCost(totalCost: string, outputQty: number): string {
  if (!Number.isSafeInteger(outputQty) || outputQty <= 0) throw new WmsError('产出数量须为正整数。', 422);
  const total = scaleCost(totalCost);
  return formatCost((total + BigInt(outputQty) / 2n) / BigInt(outputQty));
}

export function totalComponentCost(lines: Array<{ consumedQty: number; unitCost: string | { toString(): string } }>) {
  const total = lines.reduce((sum, line) => sum + scaleCost(String(line.unitCost)) * BigInt(line.consumedQty), 0n);
  return formatCost(total);
}

export function assemblyScopeKey(scope: WmsScope) {
  return [scope.organizationId, scope.workspaceId];
}
