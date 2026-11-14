export type SalesDay = { date: string; units: number };
export type MatureDemandModel = "COMPLETE_28_DAY" | "WIMOOR_7_15_30";
/**
 * Demand statistics produced by the forecast layer (`@/lib/forecast`).
 * When supplied, these replace the single-value daily demand AND the manual
 * seasonality multiplier, because the forecast already includes seasonality.
 */
export type DemandForecastInput = {
  p50Daily: number;
  p90Daily: number;
  method: string;
  confidence: string;
  asOf: string;
};
export type ReplenishmentInputs = {
  lifecycle: "NEW" | "MATURE";
  matureDemandModel: MatureDemandModel;
  productionDays: number | null; domesticDays: number | null; oceanDays: number | null;
  safetyDays: number; reviewDays: number;
  newProductDailyUnits: number | null;
  salesHistory: SalesDay[];
  // Explicit same-period comparator totals; source and period are required when supplied.
  seasonality: { multiplier: number; source: string; period: string } | null;
  /** Statistical forecast from the forecast layer; takes precedence over `seasonality`. */
  demandForecast?: DemandForecastInput | null;
  receipts: { quantity: number; eta: string }[];
  unitProfit: number | null; currency: string | null;
  acos: number | null; advertisingWindow: string | null;
  sourceNote: string;
  historicalSource?: { storeId: string } | null;
};
export type StockoutWindow = {
  /** Shortage date under median demand. */
  p50Date: string | null;
  /** Shortage date under P90 demand; never earlier than `p50Date`. */
  p90Date: string | null;
  /** Days between the two scenarios, i.e. how much the answer depends on demand uncertainty. */
  bandDays: number | null;
};
export type ReplenishmentResult = {
  version: "1" | "2"; status: "READY" | "NEEDS_DATA"; lifecycle: "NEW" | "MATURE";
  /** Median daily demand (P50). Kept as `dailyDemand` for existing consumers. */
  dailyDemand: number | null; daysOfCover: number | null; estimatedStockoutDate: string | null;
  suggestedQuantity: number | null; suggestedOrderDate: string | null;
  /** P90 daily demand when a forecast is supplied; otherwise null. */
  dailyDemandP90?: number | null;
  /** Days of cover under P90 demand. */
  daysOfCoverP90?: number | null;
  stockoutWindow?: StockoutWindow | null;
  /** Suggested quantity when planning against P90 demand (buffer-inclusive). */
  suggestedQuantityP90?: number | null;
  demandSource?: "FORECAST" | "MANUAL_SEASONALITY" | "NONE";
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
  const matureDemandModel = row.matureDemandModel ?? "COMPLETE_28_DAY";
  if (matureDemandModel !== "COMPLETE_28_DAY" && matureDemandModel !== "WIMOOR_7_15_30") throw new Error("成熟品日需求模型无效。");
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
  let demandForecast: DemandForecastInput | null = null;
  if (row.demandForecast != null) {
    const value = row.demandForecast as Record<string, unknown>;
    const p50 = number(value.p50Daily, 1_000_000);
    const p90 = number(value.p90Daily, 1_000_000);
    if (p50 === null || p90 === null) throw new Error("预测需求必须包含 P50 与 P90 日需求。");
    if (p50 <= 0) throw new Error("预测 P50 日需求必须大于 0。");
    if (p90 < p50) throw new Error("预测 P90 日需求不能小于 P50。");
    if (!day(value.asOf)) throw new Error("预测需求必须提供计算基准日。");
    demandForecast = {
      p50Daily: p50,
      p90Daily: p90,
      method: typeof value.method === "string" ? value.method.slice(0, 80) : "forecast-v1",
      confidence: typeof value.confidence === "string" ? value.confidence.slice(0, 20) : "UNKNOWN",
      asOf: value.asOf,
    };
  }
  return {
    lifecycle: row.lifecycle, matureDemandModel, productionDays: number(row.productionDays, 365, true), domesticDays: number(row.domesticDays, 365, true), oceanDays: number(row.oceanDays, 365, true),
    safetyDays: number(row.safetyDays ?? 14, 180)!, reviewDays: number(row.reviewDays ?? 30, 180)!,
    newProductDailyUnits: number(row.newProductDailyUnits, 1_000_000, true), salesHistory, seasonality, demandForecast, receipts,
    unitProfit: unitProfit as number | null, currency,
    acos: number(row.acos, 10000, true), advertisingWindow: typeof row.advertisingWindow === "string" ? row.advertisingWindow.slice(0, 200) : null,
    sourceNote: row.sourceNote.trim(), historicalSource,
  };
}
const addDays = (date: string, days: number) => new Date(Date.parse(date) + Math.ceil(days) * 86_400_000).toISOString().slice(0, 10);

export function wimoorWeightedDailyDemand(sales7: number, sales15: number, sales30: number) {
  const weighted = sales30 * 0.1 / 30 + sales15 * 0.2 / 15 + sales7 * 0.7 / 7;
  const tenths = Math.ceil(weighted * 10);
  return Math.floor(tenths / 10) + (tenths % 10 > 8 ? 1 : 0);
}

/** Simulate day-by-day depletion and return the first offset whose stock cannot cover demand. */
function firstShortageOffset(startStock: number, receipts: { quantity: number; eta: string }[], dailyDemand: number, today: string, windowDays: number): number | null {
  let stock = startStock;
  for (let offset = 0; offset <= windowDays; offset += 1) {
    const date = addDays(today, offset);
    stock += receipts.filter((row) => row.eta === date).reduce((sum, row) => sum + row.quantity, 0);
    if (stock < dailyDemand) return offset;
    stock -= dailyDemand;
  }
  return null;
}

/** Deterministic advice only. Missing facts never become zero demand or procurement orders. */
export function calculateReplenishment(input: ReplenishmentInputs, inventory: { available: number | null; inbound: number | null; fresh: boolean }, today: string): ReplenishmentResult {
  const missingInputs: string[] = [];
  const reasons = [`参数来源：${input.sourceNote}`];
  if (inventory.available === null) missingInputs.push("可售库存");
  if (!inventory.fresh) missingInputs.push("新鲜库存快照");
  const forecast = input.demandForecast ?? null;
  let dailyDemand: number | null = null;
  let dailyDemandP90: number | null = forecast ? forecast.p90Daily : null;
  if (input.lifecycle === "NEW") {
    dailyDemand = input.newProductDailyUnits;
    reasons.push("新品采用人工维护的试销日需求，不以短期广告销量外推成熟品需求。");
    if (dailyDemand === null) missingInputs.push("新品试销日需求");
    if (forecast && dailyDemand !== null) {
      dailyDemandP90 = forecast.p90Daily;
      reasons.push(`采用预测层 P90 日需求 ${forecast.p90Daily}（方法 ${forecast.method}，置信 ${forecast.confidence}）。`);
    }
  } else if (forecast) {
    dailyDemand = forecast.p50Daily;
    reasons.push(`采用预测层 P50 日需求 ${forecast.p50Daily} / P90 ${forecast.p90Daily}（方法 ${forecast.method}，置信 ${forecast.confidence}，基准日 ${forecast.asOf}）；预测已含季节性与促销弹性，不再叠加人工季节系数。`);
  } else {
    const modelDays = input.matureDemandModel === "WIMOOR_7_15_30" ? 30 : 28;
    const dates = Array.from({ length: modelDays }, (_, index) => addDays(today, -(index + 1)));
    const observations = new Map(input.salesHistory.map((row) => [row.date, row.units]));
    if (dates.some((date) => !observations.has(date))) missingInputs.push(`最近完整 ${modelDays} 天销量（缺失日不视为零）`);
    else if (input.matureDemandModel === "WIMOOR_7_15_30") {
      const total = (days: number) => dates.slice(0, days).reduce((sum, date) => sum + observations.get(date)!, 0);
      dailyDemand = wimoorWeightedDailyDemand(total(7), total(15), total(30));
      reasons.push("Wimoor 成熟品日需公式：(30天销量×0.1/30)+(15天销量×0.2/15)+(7天销量×0.7/7)，按源码规则取整；使用截至昨日的完整窗口。");
    } else {
      dailyDemand = dates.reduce((sum, date) => sum + observations.get(date)!, 0) / 28;
      reasons.push("成熟品采用截至昨日的完整 28 天日均销量。");
    }
  }
  if (!forecast && input.seasonality && dailyDemand !== null) {
    dailyDemand *= input.seasonality.multiplier;
    if (dailyDemandP90 !== null) dailyDemandP90 *= input.seasonality.multiplier;
    reasons.push(`季节性系数 ${input.seasonality.multiplier}；${input.seasonality.period}；来源：${input.seasonality.source}`);
  } else if (!forecast) reasons.push("未提供去年同期季节性资料：未应用季节性调整，旺季风险需人工复核。");
  const lead = [input.productionDays, input.domesticDays, input.oceanDays];
  ["供应商生产周期", "国内运输周期", "海运周期"].forEach((name, i) => { if (lead[i] === null) missingInputs.push(name); });
  if (input.unitProfit === null) reasons.push("利润未接通：未作盈利性判断。");
  else if (input.unitProfit <= 0) reasons.push(`单位利润 ${input.unitProfit} ${input.currency}：补货前需复核盈利性；不认定为净利润。`);
  if (input.acos === null || !input.advertisingWindow) reasons.push("广告指标或归因窗口缺失：未根据广告调整需求。");
  else reasons.push(`参考 ACOS ${input.acos}%（${input.advertisingWindow}）；不把广告归因销量重复计入总销量。`);
  const receipts = input.receipts.filter((row) => row.eta >= today);
  if (input.receipts.some((row) => row.eta < today)) reasons.push("存在逾期在途：未当作已到货库存，请核实。");
  if ((inventory.inbound ?? 0) > receipts.reduce((sum, row) => sum + row.quantity, 0)) reasons.push("库存来源总在途量超过已维护 ETA 的数量；未定到货日在途不抵扣补货需求。");
  if (dailyDemand === 0) missingInputs.push("正日需求：零销量不能推断未来需求");
  const result: ReplenishmentResult = { version: forecast ? "2" : "1", status: missingInputs.length ? "NEEDS_DATA" : "READY", lifecycle: input.lifecycle,
    dailyDemand, daysOfCover: dailyDemand && inventory.available !== null ? inventory.available / dailyDemand : null,
    estimatedStockoutDate: null, suggestedQuantity: null, suggestedOrderDate: null,
    dailyDemandP90, daysOfCoverP90: dailyDemandP90 && dailyDemandP90 > 0 && inventory.available !== null ? inventory.available / dailyDemandP90 : null,
    stockoutWindow: null, suggestedQuantityP90: null,
    demandSource: forecast ? "FORECAST" : input.seasonality ? "MANUAL_SEASONALITY" : "NONE",
    urgency: "UNKNOWN", reasons, missingInputs };
  if (missingInputs.length || !dailyDemand || inventory.available === null) return result;
  const leadDays = lead.reduce<number>((sum, value) => sum + value!, 0);
  const horizon = Math.ceil(leadDays + input.safetyDays + input.reviewDays);
  const etaLimit = addDays(today, horizon);
  const eligibleReceipts = receipts.filter((row) => row.eta <= etaLimit).reduce((sum, row) => sum + row.quantity, 0);
  result.suggestedQuantity = Math.max(0, Math.ceil(dailyDemand * horizon - inventory.available - eligibleReceipts));
  if (dailyDemandP90 !== null && dailyDemandP90 > 0) {
    result.suggestedQuantityP90 = Math.max(0, Math.ceil(dailyDemandP90 * horizon - inventory.available - eligibleReceipts));
  }
  const simulationDays = Math.min(1095, Math.max(horizon, Math.ceil((inventory.available + eligibleReceipts) / dailyDemand) + 1));
  const firstShortage = firstShortageOffset(inventory.available, receipts, dailyDemand, today, simulationDays);
  const p90Shortage = dailyDemandP90 !== null && dailyDemandP90 > 0
    ? firstShortageOffset(inventory.available, receipts, dailyDemandP90, today, simulationDays)
    : null;
  if (firstShortage !== null) {
    result.estimatedStockoutDate = addDays(today, firstShortage);
    result.suggestedOrderDate = addDays(today, firstShortage - leadDays - input.safetyDays);
    result.urgency = firstShortage <= leadDays ? "URGENT" : firstShortage <= leadDays + input.safetyDays + input.reviewDays ? "SOON" : "NORMAL";
    if (firstShortage <= leadDays) reasons.push("按现有到货计划，库存将在新订单完成运输前不足，需评估加急或调拨。");
  } else { result.urgency = "NORMAL"; reasons.push("计算窗口内未预计断货；窗口外日期不外推。"); }
  const p50Date = firstShortage === null ? null : addDays(today, firstShortage);
  const p90Date = p90Shortage === null ? null : addDays(today, p90Shortage);
  result.stockoutWindow = {
    p50Date,
    p90Date,
    bandDays: p50Date !== null && p90Date !== null ? Math.round(Math.abs(Date.parse(p90Date) - Date.parse(p50Date)) / 86_400_000) : null,
  };
  if (p90Date !== null && p50Date !== null && p90Date !== p50Date) {
    reasons.push(`需求不确定性区间：P50 情景断货 ${p50Date}，P90 情景提前至 ${p90Date}（相差 ${result.stockoutWindow.bandDays} 天）；旺季按下限备货。`);
  }
  if (result.suggestedOrderDate !== null && result.suggestedOrderDate < today) {
    reasons.push(`建议下单日 ${result.suggestedOrderDate} 已早于今天：下单窗口已错过，需按加急处理或调整安全期。`);
  }
  reasons.push(`建议量覆盖生产+运输 ${leadDays} 天、安全 ${input.safetyDays} 天及复核 ${input.reviewDays} 天；仅扣减窗口内已知 ETA 在途。`);
  return result;
}
