import { requirePositiveQuantity, requireText, strictKeys, WmsInputError } from "@/lib/wms/rules";

export type LocalPackingBox = {
  number: string; lengthCm: string; widthCm: string; heightCm: string; grossWeightKg: string;
  netWeightKg?: string;
  items: Array<{ lineId: string; quantity: number }>;
};
export type LocalPacking = { boxes: LocalPackingBox[] };
type PlanLine = { id: string; quantity: number };
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsInputError("装箱资料须为对象。");
  return raw as Record<string, unknown>;
}
function measurement(raw: unknown, label: string) {
  if (typeof raw !== "string" || !/^\d{1,6}(?:\.\d{1,3})?$/.test(raw.trim()) || Number(raw) <= 0) throw new WmsInputError(`${label}须为大于零、最多三位小数的字符串。`);
  const [integer, fraction = ""] = raw.trim().split(".");
  return `${BigInt(integer)}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
}

/** Local carton specification; this is not an Amazon packing or placement option. */
export function parseLocalPacking(raw: unknown, lines: readonly PlanLine[]): LocalPacking {
  const input = record(raw); strictKeys(input, ["boxes"]);
  if (!Array.isArray(input.boxes) || input.boxes.length < 1 || input.boxes.length > 200) throw new WmsInputError("装箱数量须为 1-200 箱。");
  const planned = new Map(lines.map(line => [line.id, line.quantity]));
  const totals = new Map<string, number>(), numbers = new Set<string>();
  let itemCount = 0;
  const boxes = input.boxes.map(rawBox => {
    const box = record(rawBox); strictKeys(box, ["number", "lengthCm", "widthCm", "heightCm", "grossWeightKg", "netWeightKg", "items"]);
    const number = requireText(box.number, "箱号", 60);
    if (numbers.has(number)) throw new WmsInputError("箱号不能重复。");
    numbers.add(number);
    if (!Array.isArray(box.items) || !box.items.length || box.items.length > 100) throw new WmsInputError("每箱须有 1-100 条明细。");
    itemCount += box.items.length;
    if (itemCount > 2000) throw new WmsInputError("装箱明细合计不能超过 2000 条。");
    const seen = new Set<string>();
    const items = box.items.map(rawItem => {
      const item = record(rawItem); strictKeys(item, ["lineId", "quantity"]);
      const lineId = requireText(item.lineId, "计划明细 ID", 100);
      if (!planned.has(lineId)) throw new WmsInputError("箱内明细不属于当前计划。");
      if (seen.has(lineId)) throw new WmsInputError("同一箱内不能重复填写计划明细。");
      seen.add(lineId);
      const quantity = requirePositiveQuantity(item.quantity);
      const total = (totals.get(lineId) ?? 0) + quantity;
      if (total > planned.get(lineId)!) throw new WmsInputError("装箱数量超过计划数量。");
      totals.set(lineId, total);
      return { lineId, quantity };
    }).sort((a, b) => a.lineId.localeCompare(b.lineId));
    const grossWeightKg=measurement(box.grossWeightKg,'毛重（千克）');
    const netWeightKg=box.netWeightKg===undefined?undefined:measurement(box.netWeightKg,'净重（千克）');
    if(netWeightKg!==undefined&&Number(netWeightKg)>Number(grossWeightKg))throw new WmsInputError('箱内净重不能超过毛重。');
    return { number, lengthCm: measurement(box.lengthCm, "箱长（厘米）"), widthCm: measurement(box.widthCm, "箱宽（厘米）"), heightCm: measurement(box.heightCm, "箱高（厘米）"), grossWeightKg, ...(netWeightKg===undefined?{}:{netWeightKg}), items };
  }).sort((a, b) => a.number.localeCompare(b.number));
  for (const line of lines) if (totals.get(line.id) !== line.quantity) throw new WmsInputError("每条计划明细的装箱合计须等于计划数量，不能漏装。");
  return { boxes };
}
