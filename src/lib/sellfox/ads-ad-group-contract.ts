/** Provisional adGroupReport columns; NOT verified against a live Sellfox XLSX. */
import { readSellfoxAdReport } from "./ads-report-contract";
import { sellfoxCpcRequiredColumns, sellfoxCpcRow } from "./ads-targeting-contract";
import { SellfoxSyncInputError } from "./sync-contract";
export async function parseSellfoxAdGroupReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  const { rows } = await readSellfoxAdReport(buffer, input, sellfoxCpcRequiredColumns);
  const identities = new Set<string>();
  return rows.map(raw => {
    const row = sellfoxCpcRow(raw), identity = JSON.stringify([row.reportDate, row.campaignId, row.adGroupId]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期。");
    identities.add(identity);
    return { ...row, adGroupName: String(raw["广告组名称"] ?? raw["广告组"] ?? "").trim() || null };
  });
}
