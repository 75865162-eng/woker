import ExcelJS from "exceljs";
import { isSellfoxDate, SellfoxSyncInputError } from "./sync-contract";
import { sellfoxNumber, type SellfoxRow } from "./narrow-contracts";
const required = ["店铺", "日期", "asin", "sku", "广告活动ID", "广告组ID", "广告产品ID", "广告曝光量", "广告点击量", "广告花费", "广告订单量", "广告销售额"];
/** Verified SP adProductReport XLSX 2026-10-25. No currency column: keep currency null. */
export async function parseSellfoxAdProductReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  if (buffer.length > 25 * 1024 * 1024) throw new SellfoxSyncInputError("广告报告超过 25MB，请缩小日期范围。");
  // Inspect ZIP central-directory declared uncompressed sizes before ExcelJS inflates entries.
  let expanded = 0; let entries = 0;
  for (let offset = 0; offset + 46 <= buffer.length; offset++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    expanded += buffer.readUInt32LE(offset + 24); entries++;
    if (expanded > 100 * 1024 * 1024 || entries > 1000) throw new SellfoxSyncInputError("广告报告解压大小超限。");
    offset += 45 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  if (!entries) throw new SellfoxSyncInputError("广告报告不是已验证的 XLSX。");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  if (workbook.worksheets.length !== 1) throw new SellfoxSyncInputError("广告报告工作表结构未验证。");
  const sheet = workbook.worksheets[0];
  if (sheet.rowCount > 50001) throw new SellfoxSyncInputError("广告报告超过五万行，请缩小范围。");
  const columns: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, index) => {
    const key = String(cell.value ?? "");
    if (key in columns) throw new SellfoxSyncInputError("广告报告存在重复列。");
    columns[key] = index;
  });
  if (required.some((key) => !columns[key])) throw new SellfoxSyncInputError("广告产品报告缺少已验证列。");
  const rows = [];
  const identities = new Set<string>();
  for (let index = 2; index <= sheet.rowCount; index++) {
    const excelRow = sheet.getRow(index); if (!excelRow.hasValues) continue;
    const raw: SellfoxRow = {};
    for (const [key, column] of Object.entries(columns)) {
      const value = excelRow.getCell(column).value;
      if (value !== null && typeof value === "object" && !(value instanceof Date)) throw new SellfoxSyncInputError("广告报告不接受公式或复合单元格。");
      raw[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    }
    const reportDate = String(raw["日期"] ?? "");
    if (!isSellfoxDate(reportDate) || reportDate < input.startDate || reportDate > input.endDate || raw["店铺"] !== input.storeName) throw new SellfoxSyncInputError("广告报告日期或店铺不匹配。");
    const campaignId = String(raw["广告活动ID"] ?? ""), adGroupId = String(raw["广告组ID"] ?? ""), productId = String(raw["广告产品ID"] ?? "");
    if (!campaignId || !adGroupId || !productId) throw new SellfoxSyncInputError("广告报告缺少稳定实体 ID。");
    const identity = JSON.stringify([reportDate, campaignId, adGroupId, productId]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期。");
    identities.add(identity);
    rows.push({ reportDate, campaignId, adGroupId, productId, asin: String(raw.asin ?? "") || null, msku: String(raw.sku ?? "") || null, currency: null,
      impressions: sellfoxNumber(raw, "广告曝光量", true), clicks: sellfoxNumber(raw, "广告点击量", true), cost: sellfoxNumber(raw, "广告花费"), adOrders: sellfoxNumber(raw, "广告订单量", true), adSales: sellfoxNumber(raw, "广告销售额"), payload: raw });
  }
  return rows;
}
export function sellfoxReportDownloadUrl(value: unknown) {
  if (typeof value !== "string") throw new SellfoxSyncInputError("广告报告下载地址无效。");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "s1.sellfox.com" || url.port || url.username || url.password) throw new SellfoxSyncInputError("广告报告下载域名尚未验证。");
  return url;
}
