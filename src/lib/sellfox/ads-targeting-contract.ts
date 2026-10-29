/** Verified 2026-10-26 against real Sellfox adTargeringReport XLSX.
 * Live ID column: 广告投放ID; legacy 投放ID remains supported, but both is ambiguous.
 * Neither ID column: hash campaign/group/投放/匹配类型; never guess from row order.
 */
import { createHash } from "node:crypto";
import { readSellfoxAdReport } from "./ads-report-contract";
import { sellfoxNumber, type SellfoxRow } from "./narrow-contracts";
import { SellfoxSyncInputError } from "./sync-contract";
export const sellfoxCpcCampaignRequiredColumns = ["店铺", "日期", "广告活动ID", "广告曝光量", "广告点击量", "广告花费", "广告订单量", "广告销售额"];
export const sellfoxCpcRequiredColumns = [...sellfoxCpcCampaignRequiredColumns, "广告组ID"];
export function sellfoxCpcCampaignRow(raw: SellfoxRow) {
  const campaignId = String(raw["广告活动ID"] ?? "").trim();
  if (!campaignId) throw new SellfoxSyncInputError("广告报告缺少稳定实体 ID。");
  return { reportDate: String(raw["日期"]), campaignId,
    asin: String(raw.asin ?? raw.ASIN ?? "") || null, msku: String(raw.sku ?? raw.SKU ?? "") || null, currency: null,
    impressions: sellfoxNumber(raw, "广告曝光量", true), clicks: sellfoxNumber(raw, "广告点击量", true), cost: sellfoxNumber(raw, "广告花费"), adOrders: sellfoxNumber(raw, "广告订单量", true), adSales: sellfoxNumber(raw, "广告销售额"), payload: raw };
}
export function sellfoxCpcRow(raw: SellfoxRow) {
  const adGroupId = String(raw["广告组ID"] ?? "").trim();
  if (!adGroupId) throw new SellfoxSyncInputError("广告报告缺少稳定实体 ID。");
  return { ...sellfoxCpcCampaignRow(raw), adGroupId, targetingText: String(raw["投放"] ?? "").trim() || null, matchType: String(raw["匹配类型"] ?? "").trim() || null };
}
export async function parseSellfoxAdTargetingReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  const { rows, columns } = await readSellfoxAdReport(buffer, input, sellfoxCpcRequiredColumns);
  if (columns["广告投放ID"] && columns["投放ID"]) throw new SellfoxSyncInputError("广告报告存在重复列：广告投放ID/投放ID。");
  const targetingIdColumn = columns["广告投放ID"] ? "广告投放ID" : columns["投放ID"] ? "投放ID" : null;
  if (!targetingIdColumn && !columns["投放"]) throw new SellfoxSyncInputError("投放报告缺少广告投放ID、投放ID或投放列。");
  const identities = new Set<string>();
  return rows.map(raw => {
    const row = sellfoxCpcRow(raw);
    const targetingId = targetingIdColumn ? String(raw[targetingIdColumn] ?? "").trim() : row.targetingText ? `text:${createHash("sha256").update(JSON.stringify([row.campaignId, row.adGroupId, row.targetingText, row.matchType])).digest("hex")}` : "";
    if (!targetingId) throw new SellfoxSyncInputError("投放报告缺少稳定投放身份。");
    const identity = JSON.stringify([row.reportDate, row.campaignId, row.adGroupId, targetingId]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期。");
    identities.add(identity); return { ...row, targetingId };
  });
}
