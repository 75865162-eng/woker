import { requireText, strictKeys, WmsInputError } from "@/lib/wms/rules";
import { object } from "./rules";
import { allocateCostHierarchy, hierarchyInput } from './cost-hierarchy';

export const allocationMethods = ["QUANTITY", "CHARGEABLE_WEIGHT", "VOLUME", "VALUE"] as const;
type Method = typeof allocationMethods[number];
const scale = BigInt(1000000);
function decimal(raw: unknown, label: string, positive = false) {
  if (typeof raw !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(raw.trim())) throw new WmsInputError(`${label}须为非负十进制字符串，最多六位小数。`);
  const [whole, fraction = ""] = raw.trim().split(".");
  const value = BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"));
  if (positive && !value) throw new WmsInputError(`${label}须大于零。`);
  return value;
}
function format(value: bigint) { return `${value / scale}.${String(value % scale).padStart(6, "0")}`; }
export type CostLine = { id: string; quantity: number };

/** Preserve Wimoor's max(actual, dimensional) basis; allocate integer micro-units with exact reconciliation. */
export function allocateLocalCost(raw: unknown, lines: readonly CostLine[]) {
  const input = object(raw);
  strictKeys(input, ["reference", "stage", "amount", "currency", "method", "basis", "hierarchy"]);
  const reference = requireText(input.reference, "费用来源单号");
  if (input.stage !== "ESTIMATE" && input.stage !== "ACTUAL") throw new WmsInputError("费用阶段须为预估或实际账单。");
  const currency = requireText(input.currency, "币种");
  if (!/^[A-Z]{3}$/.test(currency)) throw new WmsInputError("币种须为三个大写字母。");
  const amount = decimal(input.amount, "费用金额", input.stage === "ESTIMATE");
  if (!allocationMethods.includes(input.method as Method)) throw new WmsInputError("分摊方式无效。");
  const method = input.method as Method;
  if (!Array.isArray(input.basis) || input.basis.length !== lines.length) throw new WmsInputError("分摊依据须覆盖当前全部计划明细。");
  const planned = new Map(lines.map(line => [line.id, line]));
  const seen = new Set<string>();
  const bases = input.basis.map(rawBasis => {
    const basis = object(rawBasis);
    strictKeys(basis, method === "QUANTITY" ? ["lineId"] : method === "CHARGEABLE_WEIGHT" ? ["lineId", "unitWeightKg", "unitDimensionalWeightKg"] : ["lineId", method === "VOLUME" ? "unitVolumeM3" : "unitValue"]);
    const lineId = requireText(basis.lineId, "计划明细 ID");
    const line = planned.get(lineId);
    if (!line || seen.has(lineId)) throw new WmsInputError("分摊明细重复或不属于当前计划。");
    seen.add(lineId);
    let unit = scale;
    let evidence: Record<string, string> = {};
    if (method === "CHARGEABLE_WEIGHT") {
      const actual = decimal(basis.unitWeightKg, "单位实际重（kg）");
      const dimensional = decimal(basis.unitDimensionalWeightKg, "单位体积重（kg）");
      unit = actual > dimensional ? actual : dimensional;
      if (!unit) throw new WmsInputError("计费重依据缺失或为零，请维护重量。");
      evidence = { unitWeightKg: format(actual), unitDimensionalWeightKg: format(dimensional) };
    } else if (method !== "QUANTITY") {
      const key = method === "VOLUME" ? "unitVolumeM3" : "unitValue";
      unit = decimal(basis[key], method === "VOLUME" ? "单位体积（m³）" : "单位货值（同费用币种）", true);
      evidence = { [key]: format(unit) };
    }
    return { lineId, quantity: line.quantity, evidence, weight: unit * BigInt(line.quantity) };
  }).sort((a, b) => a.lineId.localeCompare(b.lineId));
  const total = bases.reduce((sum, row) => sum + row.weight, BigInt(0));
  if (!total) throw new WmsInputError("分摊依据合计不能为零。");
  const shares = bases.map(row => ({ ...row, allocated: amount * row.weight / total, remainder: amount * row.weight % total }));
  const remaining = amount - shares.reduce((sum, row) => sum + row.allocated, BigInt(0));
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.lineId.localeCompare(b.lineId) : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < Number(remaining); i++) ranked[i].allocated++;
  const hierarchy = input.hierarchy === undefined ? null : allocateCostHierarchy(input.hierarchy, format(amount), bases.map(row=>({lineId:row.lineId,quantity:row.quantity,basis:format(row.weight)})));
  if(hierarchy)for(const row of shares)row.allocated=hierarchy.lineShares.get(row.lineId)!;
  return { version: 1, reference, stage: input.stage, currency, amount: format(amount), method,
    ...(hierarchy ? { hierarchy: {shipments:hierarchy.shipments} } : {}),
    lines: shares.map(row => ({ lineId: row.lineId, quantity: row.quantity, ...row.evidence, basis: format(row.weight), allocatedAmount: format(row.allocated), unitCost: format(row.allocated / BigInt(row.quantity)), unitCostRemainder: format(row.allocated % BigInt(row.quantity)) })) };
}

export function readLocalCost(raw: unknown, lines: readonly CostLine[]) {
  const value = object(raw);
  if (value.version !== 1) throw new WmsInputError("费用分摊版本不受支持。", 409);
  if (!Array.isArray(value.lines)) throw new WmsInputError("已保存费用明细无效。", 409);
  const basis = value.lines.map(rawLine => {
    const row = object(rawLine);
    return { lineId: row.lineId, ...(value.method === "CHARGEABLE_WEIGHT" ? { unitWeightKg: row.unitWeightKg, unitDimensionalWeightKg: row.unitDimensionalWeightKg } : value.method === "VOLUME" ? { unitVolumeM3: row.unitVolumeM3 } : value.method === "VALUE" ? { unitValue: row.unitValue } : {}) };
  });
  const hierarchy = value.hierarchy === undefined ? undefined : hierarchyInput((value.hierarchy as {shipments:ReturnType<typeof allocateCostHierarchy>['shipments']}).shipments);
  return allocateLocalCost({ reference: value.reference, stage: value.stage, amount: value.amount, currency: value.currency, method: value.method, basis, ...(hierarchy ? {hierarchy} : {}) }, lines);
}
