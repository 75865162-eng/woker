import { campaignFixtures, groupFixtures } from "./fixtures/catalog";
import type { AdsDataProvider, AdsDataset, AdsQuery, AdsRow, DateRange, Facts, Metrics } from "./types";
export const metricLabels = { impressions: "展示量", clicks: "点击量", ctr: "CTR", spend: "总成本", cpc: "CPC", orders: "购买量", sales: "销售额", acos: "ACOS", roas: "ROAS", conversion: "购买率" };
export const emptyFacts = (): Facts => ({ impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 });
export function metrics(f: Facts): Metrics { return { ...f, ctr: f.impressions ? f.clicks / f.impressions * 100 : 0, cpc: f.clicks ? f.spend / f.clicks : 0, acos: f.sales ? f.spend / f.sales * 100 : 0, roas: f.spend ? f.sales / f.spend : 0, conversion: f.clicks ? f.orders / f.clicks * 100 : 0 }; }
export function sumMetrics(rows: Facts[]): Metrics { return metrics(rows.reduce((sum, r) => ({ impressions: sum.impressions + r.impressions, clicks: sum.clicks + r.clicks, spend: sum.spend + r.spend, orders: sum.orders + r.orders, sales: sum.sales + r.sales }), emptyFacts())); }
export function datesInRange(range: DateRange): string[] {
  const start = Date.parse(range.from), end = Date.parse(range.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 365 * 86400000) return [];
  return Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
function dailyFacts(index: number, date: string, scopeSeed: number): Facts {
  const day = Math.floor(Date.parse(date) / 86400000);
  const n = (index * 17 + day * 13 + scopeSeed * 29) % 113;
  const clicks = 5 + n % 33, orders = Math.floor(clicks * (0.05 + n % 9 / 100));
  return { impressions: clicks * (43 + n % 110), clicks, orders, spend: Math.round(clicks * (52 + n % 67)) / 100, sales: orders * (24 + index % 25) };
}
export const mockAdsProvider: AdsDataProvider = {
  read(q: AdsQuery): AdsDataset {
    const campaigns = campaignFixtures(q).filter(c => !q.adType || c.adType === q.adType), groups = groupFixtures(q).filter(g => (!q.adType || g.adType === q.adType) && (!q.campaignId || g.campaignId === q.campaignId) && (!q.adGroupId || g.id === q.adGroupId));
    const dates = datesInRange(q), seed = [...q.account + q.marketplace].reduce((n, c) => n + c.charCodeAt(0), 0);
    const groupRows: AdsRow[] = groups.map(g => ({ ...g, adGroupId: g.id, adGroup: g.name, ...sumMetrics(dates.map(d => dailyFacts(g.index, d, seed))) }));
    const trend = dates.map(date => ({ date, ...sumMetrics(groups.map(g => dailyFacts(g.index, date, seed))) }));
    let rows: AdsRow[];
    if (q.entity === "campaigns") rows = campaigns.filter(c => (!q.campaignId || c.id === q.campaignId) && (!q.adGroupId || groups.some(g => g.campaignId === c.id))).map(c => ({ ...c, campaignId: c.id, campaign: c.name, ...sumMetrics(groupRows.filter(g => g.campaignId === c.id)) }));
    else if (q.entity === "ad-groups") rows = groupRows;
    else if (q.entity === "placements") rows = campaigns.filter(c => groups.some(g => g.campaignId === c.id)).flatMap(c => ["Top of Search", "Product Pages", "Rest of Search"].map((name, i) => ({ ...c, id: `${c.id}-placement-${i}`, name, kind: "广告位", campaignId: c.id, campaign: c.name, ...splitFacts(sumMetrics(groupRows.filter(g => g.campaignId === c.id)), i, 3) })));
    else rows = groupRows.flatMap(g => Array.from({ length: q.entity === "negatives" ? 2 : 4 }, (_, i) => ({
      ...g, id: `${g.id}-${q.entity}-${i}`, name: q.entity === "products" ? `B0DEMO${String(g.id.length).padStart(3, "0")}${i}` : q.entity === "targets" ? `asin="B0DEMO${String(i + 1).padStart(4, "0")}"` : q.entity === "negatives" ? ["free", 'asin="B0DEMO0001"'][i] : `${g.name.split(" - ")[0].toLowerCase()} ${["organizer", "set", "for home", "large"][i]}`,
      expression: q.entity === "search-terms" ? `${g.name.split(" - ")[0]}${i === 3 ? ` · asin="B0DEMO${String((Array.from(g.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 10000)).padStart(4, "0")}"` : " · 关键词"}` : i % 2 ? "同类商品" : "关键词",
      trigger: q.entity === "search-terms" ? g.name.split(" - ")[0] : undefined,
      match: q.entity === "negatives" ? (i ? "ASIN" : "否定精准") : q.entity === "targets" ? "ASIN" : q.entity === "search-terms" ? ["精准", "词组", "广泛", "精准"][i] : ["精准", "词组", "广泛", "精准"][i],
      kind: q.entity === "negatives" ? (i ? "否定商品投放" : "否定关键词") : q.entity === "search-terms" ? (i === 3 ? "商品投放" : "关键词") : undefined,
      ...(q.entity === "negatives" ? metrics(emptyFacts()) : splitFacts(g, i, 4)),
    })));
    return { rows, trend, total: sumMetrics(rows) };
  },
};
function splitFacts(f: Facts, index: number, count: number): Metrics {
  const part = (v: number) => Math.floor(v / count) + (index < v % count ? 1 : 0);
  return metrics({ impressions: part(f.impressions), clicks: part(f.clicks), orders: part(f.orders), spend: part(Math.round(f.spend * 100)) / 100, sales: part(Math.round(f.sales * 100)) / 100 });
}
export function csv(rows: Array<Record<string, unknown>>, columns: Array<{ key: string; label: string }>): string {
  const cell = (v: unknown) => { const s = String(v ?? ""); return `"${(/^[\s]*[=+\-@]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`; };
  return "\uFEFF" + [columns.map(c => cell(c.label)).join(","), ...rows.map(r => columns.map(c => cell(r[c.key])).join(","))].join("\r\n");
}
export function downloadCsv(content: string, name: string) { const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
