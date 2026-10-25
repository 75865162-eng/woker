import type { MarketExecutionOutput, MarketEvidenceItem, ProductOpportunity } from "./market";
import { isObject } from "./handoff";

export const selectionEvidenceMaxBytes = 2 * 1024 * 1024;
export class SelectionEvidenceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const fail = (message: string): never => { throw new SelectionEvidenceError(message); };
function text(value: unknown, label: string, max = 300) {
  if (typeof value !== "string" || !value.trim() || value.length > max) return fail(`${label} 无效。`);
  return value.trim();
}
function metric(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER, integer = false): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) return fail(`${label} 无效。`);
  return value;
}
function sourceUrl(value: unknown, domain: string) {
  const raw = text(value, "来源链接", 2000);
  let url: URL;
  try { url = new URL(raw); } catch { return fail("来源链接无效。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return fail("来源链接不属于允许的站点。");
  return url;
}

/** Accept only the bounded research slice of a Round B draft. Product payload is never executed. */
export function parseSelectionEvidence(value: unknown, now = new Date()) {
  if (!isObject(value) || value.schemaVersion !== 1 || value.fixture !== false) return fail("需要 schemaVersion=1、fixture=false 的 Round B 实际采集草稿；示例不可用于业务交接。");
  if (!isObject(value.brief)) return fail("缺少选品 brief。");
  const keyword = text(value.brief.keyword, "关键词");
  const priceMin = metric(value.brief.priceMin, "目标最低价");
  const priceMax = metric(value.brief.priceMax, "目标最高价");
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) return fail("目标价带无效。");
  const slug = text(value.slug, "选品批次", 80);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return fail("选品批次无效。");
  if (!Array.isArray(value.competitors) || !value.competitors.length || value.competitors.length > 50) return fail("需要 1–50 个有采集时间的竞品。");
  const seen = new Set<string>();
  const competitors = value.competitors.map((item) => {
    if (!isObject(item)) return fail("竞品格式无效。");
    const asin = text(item.asin, "ASIN", 10);
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return fail("ASIN 无效或重复。");
    seen.add(asin);
    const url = sourceUrl(item.url, "amazon.com");
    if (!url.pathname.includes(`/dp/${asin}`) && !url.pathname.includes(`/gp/product/${asin}`)) return fail("竞品链接与 ASIN 不匹配。");
    const capturedAt = text(item.capturedAt, "采集时间", 40);
    const timestamp = Date.parse(capturedAt);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 300_000) return fail("采集时间无效或晚于当前时间。");
    return { asin, title: text(item.title, "竞品标题", 1000), url: url.toString(), capturedAt: new Date(timestamp).toISOString(),
      price: metric(item.price, "价格"), rating: metric(item.rating, "评分", 5),
      reviewsCount: metric(item.reviewsCount, "评论数", Number.MAX_SAFE_INTEGER, true), bsr: metric(item.bsr, "BSR", Number.MAX_SAFE_INTEGER, true),
      sales30Days: { value: metric(isObject(item.sales30Days) ? item.sales30Days.value : item.sales30Days, "销量估算"), heuristic: true as const, method: "uncalibrated_bsr_power_law" } };
  });
  if (!isObject(value.tags) || !Array.isArray(value.tags.matches) || value.tags.matches.length > 1000) return fail("差评标签结构无效或超过上限。");
  const quoteKeys = new Set<string>();
  const tags = value.tags.matches.map((item) => {
    if (!isObject(item) || !seen.has(String(item.asin)) || !["dictionary", "cloud"].includes(String(item.source))) return fail("标签缺少有效竞品或来源。");
    const tag = text(item.tag, "标签", 80), quote = text(item.quote, "评论引用", 240);
    const key = JSON.stringify([item.asin, tag, quote]);
    if (quoteKeys.has(key)) return fail("差评标签重复。");
    quoteKeys.add(key);
    return { asin: String(item.asin), tag, quote, source: String(item.source) };
  });
  if (!Array.isArray(value.suppliers) || value.suppliers.length > 20) return fail("供应商结构无效或超过上限。");
  const suppliers = value.suppliers.map((item) => {
    if (!isObject(item)) return fail("供应商格式无效。");
    const url = sourceUrl(item.url, "1688.com");
    if (/^\/offer\/10000000000[123]\.html$/.test(url.pathname) || item.shopName === "fixture-only") return fail("离线虚构供应商不可用于真实选品交接，请补充人工核验的供应文件。");
    if (url.hostname !== "detail.1688.com" || !/^\/offer\/\d+\.html$/.test(url.pathname)) return fail("供应商链接不是已支持的 1688 商品页。");
    return { title: text(item.title, "供应商标题", 1000), url: url.origin + url.pathname,
      shopName: typeof item.shopName === "string" && item.shopName.length <= 300 ? item.shopName : fail("供应商店铺无效。"), price: typeof item.price === "string" && item.price.length <= 200 ? item.price : fail("供应商报价无效。"),
      moq: typeof item.moq === "string" && item.moq.length <= 200 ? item.moq : fail("供应商起订量无效。") };
  });
  return { schemaVersion: 1 as const, slug, keyword, priceMin, priceMax, competitors, tags, suppliers };
}

export function buildSelectionMarketOutput(value: unknown, source: { fileId: string; sha256: string }, now = new Date()): MarketExecutionOutput {
  const data = parseSelectionEvidence(value, now);
  const generatedAt = now.toISOString();
  const evidence: MarketEvidenceItem[] = data.competitors.map((item) => ({
    claim: `${item.asin} 的 Round B 导入采集快照（未独立核验）`, dataSource: item.url, toolId: "market.selection.run",
    metric: "competitor_snapshot", value: { ...item, fileId: source.fileId, sha256: source.sha256 }, timestamp: item.capturedAt,
  }));
  for (const tag of data.tags) {
    const item = data.competitors.find((c) => c.asin === tag.asin)!;
    evidence.push({ claim: "Round B 差评标签引用，需人工核对原文", dataSource: item.url, toolId: "market.selection.run", metric: "review_quote", value: tag, timestamp: item.capturedAt });
  }
  evidence.push({ claim: "供应商线索随草稿导入；报价、起订量与资质待核实", dataSource: `file:${source.fileId}`, toolId: "market.selection.run", metric: "supplier_shortlist_import", value: { suppliers: data.suppliers, importedAt: generatedAt }, timestamp: generatedAt });
  const observed = data.competitors.reduce((sum, c) => sum + [c.price, c.rating, c.reviewsCount, c.bsr].filter((v) => v !== null).length, 0);
  const completeness = Math.round(observed / (data.competitors.length * 4) * 100);
  const stale = data.competitors.some((c) => now.getTime() - Date.parse(c.capturedAt) > 7 * 86400_000);
  const missing = ["市场需求", "竞争强度", "趋势", "关键词流量", "利润率", "合规风险"];
  const researchGap = !data.tags.length || data.suppliers.length < 3 ? "NEEDS_DATA：低星标签或至少 3 条供应线索不足，不可标为直播选品验收通过。" : "研究门槛仍需在本机 quality.json 与原始评论/图片中核对；导入不等于验收通过。";
  const opportunity: ProductOpportunity = {
    opportunityId: `selection-${source.sha256}`, productIdea: data.keyword, marketplace: "US", category: "待核实",
    targetPrice: data.priceMin !== null || data.priceMax !== null ? `$${data.priceMin ?? "?"}–$${data.priceMax ?? "?"}（目标）` : "待核实",
    estimatedDemand: null, competitionScore: null, reviewBarrier: null, keywordOpportunity: null, trendScore: null,
    differentiationOpportunity: null, estimatedMargin: null, riskScore: null, opportunityScore: null, evidenceCompleteness: completeness,
    scoreBasis: "evidence_completeness", confidence: 0, evidence,
    recommendation: `${researchGap} 证据完整度 ${completeness}/100；不代表商业机会评分。${missing.join("、")}未知。${stale ? "存在超过 7 天的快照，请重新核实。" : ""}请人工审阅后再交接产品。`,
  };
  const blueOceanRadar = { blueOceanIndex: null, demandStrength: null, competitionStrength: null, entryBarrier: null, explanation: "竞品样本不足以推断整体市场；保留未知。" };
  const report = {
    goal: `审阅 ${data.keyword} 的 Round B 采集证据`, marketplace: "US", keyword: data.keyword,
    searchStrategy: [{ step: "读取已上传的 Round B 草稿", toolId: "market.selection.run", rationale: "复用实际采集产物，不请求外部站点，不启动 CLI。" }],
    blueOceanRadar,
    signals: { demandStrength: null, competitionStrength: null, entryBarrier: null, keywordOpportunity: null, trendScore: null, reviewBarrier: null, differentiationOpportunity: null, estimatedMargin: null },
    productOpportunities: [opportunity], evidence,
    summary: `导入 ${data.competitors.length} 个竞品、${data.tags.length} 条差评标签和 ${data.suppliers.length} 条供应商线索。来源为操作者上传，未独立核验；置信度尚未评估。`,
    recommendation: opportunity.recommendation, generatedAt,
    selectionSource: { ...source, schemaVersion: 1, slug: data.slug, importedAt: generatedAt, stale, suppliers: data.suppliers },
  };
  return { report, blueOceanRadar, productOpportunities: [opportunity], evidence };
}
