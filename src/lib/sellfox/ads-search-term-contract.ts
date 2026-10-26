/** Verified 2026-10-26 against real Sellfox adSearchTermReport XLSX.
 * Live ID column: 广告投放ID; legacy 投放ID remains supported, but both is ambiguous.
 * targetingId participates in identity. With neither ID column, use an empty-string sentinel
 * (not NULL), keeping PostgreSQL uniqueness effective. A present column requires IDs.
 */
import { readSellfoxAdReport } from "./ads-report-contract";
import { sellfoxCpcRequiredColumns, sellfoxCpcRow } from "./ads-targeting-contract";
import { SellfoxSyncInputError } from "./sync-contract";
export async function parseSellfoxAdSearchTermReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  const { rows, columns } = await readSellfoxAdReport(buffer, input, [...sellfoxCpcRequiredColumns, "用户搜索词"]);
  if (columns["广告投放ID"] && columns["投放ID"]) throw new SellfoxSyncInputError("广告报告存在重复列：广告投放ID/投放ID。");
  const targetingIdColumn = columns["广告投放ID"] ? "广告投放ID" : columns["投放ID"] ? "投放ID" : null;
  const identities = new Set<string>();
  return rows.map(raw => {
    const row = sellfoxCpcRow(raw), searchTerm = String(raw["用户搜索词"] ?? "").trim(), targetingId = targetingIdColumn ? String(raw[targetingIdColumn] ?? "").trim() : "";
    if (!searchTerm || (targetingIdColumn && !targetingId)) throw new SellfoxSyncInputError("搜索词报告缺少稳定搜索词/投放身份。");
    const identity = JSON.stringify([row.reportDate, row.campaignId, row.adGroupId, searchTerm, targetingId]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期。");
    identities.add(identity); return { ...row, searchTerm, targetingId };
  });
}
