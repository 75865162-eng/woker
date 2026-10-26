/** Provisional adCampaignReport columns; NOT verified against a live Sellfox XLSX.
 * Campaign grain deliberately does not require or identify by adGroupId.
 */
import { readSellfoxAdReport } from "./ads-report-contract";
import { sellfoxCpcCampaignRequiredColumns, sellfoxCpcCampaignRow } from "./ads-targeting-contract";
import { SellfoxSyncInputError } from "./sync-contract";
export async function parseSellfoxAdCampaignReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  const { rows } = await readSellfoxAdReport(buffer, input, sellfoxCpcCampaignRequiredColumns);
  const identities = new Set<string>();
  return rows.map(raw => {
    const row = sellfoxCpcCampaignRow(raw), identity = JSON.stringify([row.reportDate, row.campaignId]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期。");
    identities.add(identity);
    return { ...row, campaignName: String(raw["广告活动名称"] ?? raw["广告活动"] ?? "").trim() || null };
  });
}
