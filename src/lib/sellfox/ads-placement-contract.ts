/** Provisional adSpaceReport columns; NOT verified against a live Sellfox XLSX.
 * Require 广告位 exactly. Typical CPC placement grain is campaign/placement/day;
 * optional 广告组ID is metadata, never identity. Group-scoped duplicate rows fail closed.
 */
import { readSellfoxAdReport } from "./ads-report-contract";
import { sellfoxCpcCampaignRequiredColumns, sellfoxCpcCampaignRow } from "./ads-targeting-contract";
import { SellfoxSyncInputError } from "./sync-contract";
export async function parseSellfoxAdPlacementReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  const { rows } = await readSellfoxAdReport(buffer, input, [...sellfoxCpcCampaignRequiredColumns, "广告位"]);
  const identities = new Set<string>();
  return rows.map(raw => {
    const row = sellfoxCpcCampaignRow(raw), placement = String(raw["广告位"] ?? "").trim();
    if (!placement) throw new SellfoxSyncInputError("广告位报告缺少稳定广告位身份。");
    const identity = JSON.stringify([row.reportDate, row.campaignId, placement]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期；广告位暂按活动级契约，广告组粒度未验证。");
    identities.add(identity);
    return { ...row, placement, adGroupId: String(raw["广告组ID"] ?? "").trim() || null };
  });
}
