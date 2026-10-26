/** Provisional adSearchTermReport columns; NOT verified against a live Sellfox XLSX.
 * targetingId participates in identity. Absent column uses an empty-string sentinel
 * (not NULL), keeping PostgreSQL uniqueness effective. A present column requires IDs.
 */
import { readSellfoxAdReport } from "./ads-report-contract";
import { sellfoxCpcRequiredColumns, sellfoxCpcRow } from "./ads-targeting-contract";
import { SellfoxSyncInputError } from "./sync-contract";
export async function parseSellfoxAdSearchTermReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  const { rows, columns } = await readSellfoxAdReport(buffer, input, [...sellfoxCpcRequiredColumns, "用户搜索词"]);
  const identities = new Set<string>();
  return rows.map(raw => {
    const row = sellfoxCpcRow(raw), searchTerm = String(raw["用户搜索词"] ?? "").trim(), targetingId = String(raw["投放ID"] ?? "").trim();
    if (!searchTerm || (columns["投放ID"] && !targetingId)) throw new SellfoxSyncInputError("搜索词报告缺少稳定搜索词/投放身份。");
    const identity = JSON.stringify([row.reportDate, row.campaignId, row.adGroupId, searchTerm, targetingId]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期。");
    identities.add(identity); return { ...row, searchTerm, targetingId };
  });
}
