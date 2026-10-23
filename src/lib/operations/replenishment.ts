export type SalesDay = { date: string; units: number };
export type ReplenishmentInputs = {
  lifecycle: "NEW" | "MATURE";
  productionDays: number | null; domesticDays: number | null; oceanDays: number | null;
  safetyDays: number; reviewDays: number;
  newProductDailyUnits: number | null;
  salesHistory: SalesDay[];
  // Explicit same-period comparator totals; source and period are required when supplied.
  seasonality: { multiplier: number; source: string; period: string } | null;
  receipts: { quantity: number; eta: string }[];
  unitProfit: number | null; currency: string | null;
  acos: number | null; advertisingWindow: string | null;
  sourceNote: string;
  historicalSource?: { storeId: string } | null;
};
export type ReplenishmentResult = {
  version: "1"; status: "READY" | "NEEDS_DATA"; lifecycle: "NEW" | "MATURE";
  dailyDemand: number | null; daysOfCover: number | null; estimatedStockoutDate: string | null;
  suggestedQuantity: number | null; suggestedOrderDate: string | null;
  urgency: "UNKNOWN" | "URGENT" | "SOON" | "NORMAL";
  reasons: string[]; missingInputs: string[];
};

function day(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function number(value: unknown, max: number, nullable = false): number | null {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw new Error("补货参数包含无效数值。");
  return value;
}
export function parseReplenishmentInputs(raw: unknown): ReplenishmentInputs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("缺少补货参数。");
  const row = raw as Record<string, unknown>;
  if (row.lifecycle !== "NEW" && row.lifecycle !== "MATURE") throw new Error("请选择新品或成熟品。");
  if (typeof row.sourceNote !== "string" || !row.sourceNote.trim() || row.sourceNote.length > 500) throw new Error("必须填写销量及参数来源说明（最多 500 字）。");
  const history = row.salesHistory ?? [];
  if (!Array.isArray(history) || history.length > 366) throw new Error("销量历史最多 366 天。");
  const seen = new Set<string>();
  const salesHistory = history.map((item): SalesDay => {
    if (!item || typeof item !== "object" || !day(item.date) || seen.has(item.date)) throw new Error("销量日期无效或重复。");
    seen.add(item.date);
    const units = number(item.units, 1_000_000)!;
    if (!Number.isInteger(units)) throw new Error("销量必须为整数。");
    return { date: item.date, units };
  });
  const rawReceipts = row.receipts ?? [];
  if (!Array.isArray(rawReceipts) || rawReceipts.length > 100) throw new Error("在途批次最多 100 条。");
  const receipts = rawReceipts.map((item) => {
    if (!item || typeof item !== "object" || !day(item.eta)) throw new Error("在途批次必须有有效预计到货日期。");
    return { eta: item.eta as string, quantity: number(item.quantity, 1_000_000)! };
  });
  let seasonality: ReplenishmentInputs["seasonality"] = null;
  if (row.seasonality != null) {
    const value = row.seasonality as Record<string, unknown>;
    if (typeof value.source !== "string" || !value.source.trim() || value.source.length > 500 || typeof value.period !== "string" || !value.period.trim() || value.period.length > 100) throw new Error("季节性系数必须有来源及去年同期口径。");
    seasonality = { multiplier: number(value.multiplier, 10)!, source: value.source, period: value.period };
    if (seasonality.multiplier <= 0) throw new Error("季节性系数必须大于 0。");
  }
  const unitProfit = row.unitProfit == null ? null : row.unitProfit;
  if (unitProfit !== null && (typeof unitProfit !== "number" || !Number.isFinite(unitProfit) || Math.abs(unitProfit) > 1_000_000)) throw new Error("单位利润无效。");
  const currency = typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null;
  if (unitProfit !== null && !currency) throw new Error("利润必须提供三位币种。");
  let historicalSource: ReplenishmentInputs["historicalSource"] = null;
  if (row.historicalSource != null) {
    const source = row.historicalSource as Record<string, unknown>;
    if (typeof source.storeId !== "string" || !source.storeId.trim() || source.storeId.length > 200) throw new Error("历史报表来源必须有明确店铺 ID。");
    historicalSource = { storeId: source.storeId.trim() };
  }
  return {
    lifecycle: row.lifecycle, productionDays: number(row.productionDays, 365, true), domesticDays: number(row.domesticDays, 365, true), oceanDays: number(row.oceanDays, 365, true),
    safetyDays: number(row.safetyDays ?? 14, 180)!, reviewDays: number(row.reviewDays ?? 30, 180)!,
    newProductDailyUnits: number(row.newProductDailyUnits, 1_000_000, true), salesHistory, seasonality, receipts,
    unitProfit: unitProfit as number | null, currency,
    acos: number(row.acos, 10000, true), advertisingWindow: typeof row.advertisingWindow === "string" ? row.advertisingWindow.slice(0, 200) : null,
    sourceNote: row.sourceNote.trim(), historicalSource,
  };
}
const addDays = (date: string, days: number) => new Date(Date.parse(date) + Math.ceil(days) * 86_400_000).toISOString().slice(0, 10);

/** Deterministic advice only. Missing facts never become zero demand or procurement orders. */
export function calculateReplenishment(input: ReplenishmentInputs, inventory: { available: number | null; inbound: number | null; fresh: boolean }, today: string): ReplenishmentResult {
  const missingInputs: string[] = [];
  const reasons = [`参数来源：${input.sourceNote}`];
  if (inventory.available === null) missingInputs.push("可售库存");
  if (!inventory.fresh) missingInputs.push("新鲜库存快照");
  let dailyDemand: number | null = null;
  if (input.lifecycle === "NEW") {
    dailyDemand = input.newProductDailyUnits;
    reasons.push("新品采用人工维护的试销日需求，不以短期广告销量外推成熟品需求。");
    if (dailyDemand === null) missingInputs.push("新品试销日需求");
  } else {
    const dates = Array.from({ length: 28 }, (_, index) => addDays(today, -(index + 1)));
    const observations = new Map(input.salesHistory.map((row) => [row.date, row.units]));
    if (dates.some((date) => !observations.has(date))) missingInputs.push("最近完整 28 天销量（缺失日不视为零）");
    else dailyDemand = dates.reduce((sum, date) => sum + observations.get(date)!, 0) / 28;
    reasons.push("成熟品采用昨日结束的完整 28 天日均销量。");
  }
  if (input.seasonality && dailyDemand !== null) {
    dailyDemand *= input.seasonality.multiplier;
    reasons.push(`季节性系数 ${input.seasonality.multiplier}；${input.seasonality.period}；来源：${input.seasonality.source}`);
  } else reasons.push("未提供去年同期季节性资料：未应用季节性调整，旺季风险需人工复核。");
  const lead = [input.productionDays, input.domesticDays, input.oceanDays];
  ["供应商生产周期", "国内运输周期", "海运周期"].forEach((name, i) => { if (lead[i] === null) missingInputs.push(name); });
  if (input.unitProfit === null) reasons.push("利润未接通：未作盈利性判断。");
  else if (input.unitProfit <= 0) reasons.push(`单位利润 ${input.unitProfit} ${input.currency}：补货前需复核盈利性；不认定为净利润。`);
  if (input.acos === null || !input.advertisingWindow) reasons.push("广告指标或归因窗口缺失：未根据广告调整需求。");
  else reasons.push(`参考 ACOS ${input.acos}%（${input.advertisingWindow}）；不把广告归因销量重复计入总销量。`);
  const receipts = input.receipts.filter((row) => row.eta >= today);
  if (input.receipts.some((row) => row.eta < today)) reasons.push("存在逾期在途：未当作已到货库存，请核实。");
  if ((inventory.inbound ?? 0) > receipts.reduce((sum, row) => sum + row.quantity, 0)) reasons.push("Amazon 总在途量超过已维护 ETA 的数量；未定到货日在途不抵扣补货需求。");
  if (dailyDemand === 0) missingInputs.push("正日需求：零销量不能推断未来需求");
  const result: ReplenishmentResult = { version: "1", status: missingInputs.length ? "NEEDS_DATA" : "READY", lifecycle: input.lifecycle,
    dailyDemand, daysOfCover: dailyDemand && inventory.available !== null ? inventory.available / dailyDemand : null,
    estimatedStockoutDate: null, suggestedQuantity: null, suggestedOrderDate: null, urgency: "UNKNOWN", reasons, missingInputs };
  if (missingInputs.length || !dailyDemand || inventory.available === null) return result;
  const leadDays = lead.reduce<number>((sum, value) => sum + value!, 0);
  const horizon = Math.ceil(leadDays + input.safetyDays + input.reviewDays);
  const etaLimit = addDays(today, horizon);
  const eligibleReceipts = receipts.filter((row) => row.eta <= etaLimit).reduce((sum, row) => sum + row.quantity, 0);
  result.suggestedQuantity = Math.max(0, Math.ceil(dailyDemand * horizon - inventory.available - eligibleReceipts));
  let stock = inventory.available;
  let firstShortage: number | null = null;
  const simulationDays = Math.min(1095, Math.max(horizon, Math.ceil((stock + eligibleReceipts) / dailyDemand) + 1));
  for (let offset = 0; offset <= simulationDays; offset++) {
    const date = addDays(today, offset);
    stock += receipts.filter((row) => row.eta === date).reduce((sum, row) => sum + row.quantity, 0);
    if (stock < dailyDemand) { firstShortage = offset; break; }
    stock -= dailyDemand;
  }
  if (firstShortage !== null) {
    result.estimatedStockoutDate = addDays(today, firstShortage);
    result.suggestedOrderDate = addDays(today, firstShortage - leadDays - input.safetyDays);
    result.urgency = firstShortage <= leadDays ? "URGENT" : firstShortage <= leadDays + input.safetyDays + input.reviewDays ? "SOON" : "NORMAL";
    if (firstShortage <= leadDays) reasons.push("按现有到货计划，库存将在新订单完成运输前不足，需评估加急或调拨。");
  } else { result.urgency = "NORMAL"; reasons.push("计算窗口内未预计断货；窗口外日期不外推。"); }
  reasons.push(`建议量覆盖生产+运输 ${leadDays} 天、安全 ${input.safetyDays} 天及复核 ${input.reviewDays} 天；仅扣减窗口内已知 ETA 在途。`);
  return result;
}
