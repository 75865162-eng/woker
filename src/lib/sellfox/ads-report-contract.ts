import ExcelJS from "exceljs";
import { isSellfoxDate, SellfoxSyncInputError } from "./sync-contract";
import { sellfoxNumber, type SellfoxRow } from "./narrow-contracts";
const required = ["店铺", "日期", "asin", "sku", "广告活动ID", "广告组ID", "广告产品ID", "广告曝光量", "广告点击量", "广告花费", "广告订单量", "广告销售额"];
/**
 * XLSX 防护上限。默认口径依据真实赛狐投放报告实测（2026-11-22）：单个分片压缩约 11.5MB、
 * 解压约 175MB、单分片约 9 万行；上升至仍能 fail-closed 的上限，防 zip bomb 依然有效。
 * 全部支持环境变量覆盖并做上下限钳制（fail-closed）：异常配置不会放大到危险值。
 */
function readBoundedBytes(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
export const MAX_REPORT_BYTES = () => readBoundedBytes("SELLFOX_AD_REPORT_MAX_BYTES", 64 * 1024 * 1024, 25 * 1024 * 1024, 256 * 1024 * 1024);
const MAX_EXPANDED_BYTES = () => readBoundedBytes("SELLFOX_AD_REPORT_MAX_EXPANDED_BYTES", 512 * 1024 * 1024, 100 * 1024 * 1024, 1024 * 1024 * 1024);
const MAX_REPORT_ROWS = () => readBoundedBytes("SELLFOX_AD_REPORT_MAX_ROWS", 200_000, 50_001, 500_000);
/** Shared strict XLSX envelope; report-specific required columns are supplied by each contract. */
export async function readSellfoxAdReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }, required: readonly string[]) {
  if (buffer.length > MAX_REPORT_BYTES()) throw new SellfoxSyncInputError("广告报告超过大小上限，请缩小日期范围。");
  // Inspect ZIP central-directory declared uncompressed sizes before ExcelJS inflates entries.
  let expanded = 0; let entries = 0;
  for (let offset = 0; offset + 46 <= buffer.length; offset++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    expanded += buffer.readUInt32LE(offset + 24); entries++;
    if (expanded > MAX_EXPANDED_BYTES() || entries > 1000) throw new SellfoxSyncInputError("广告报告解压大小超限。");
    offset += 45 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  if (!entries) throw new SellfoxSyncInputError("广告报告不是已验证的 XLSX。");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  if (workbook.worksheets.length !== 1) throw new SellfoxSyncInputError("广告报告工作表结构未验证。");
  const sheet = workbook.worksheets[0];
  if (sheet.rowCount > MAX_REPORT_ROWS()) throw new SellfoxSyncInputError("广告报告超过行数上限，请缩小范围。");
  const columns: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, index) => {
    const key = String(cell.value ?? "");
    if (key in columns) throw new SellfoxSyncInputError("广告报告存在重复列。");
    columns[key] = index;
  });
  // Real SB/SD exports use uppercase ASIN/SKU; keep original names in the audit payload.
  for (const key of ["asin", "sku"]) {
    if (columns[key] && columns[key.toUpperCase()]) throw new SellfoxSyncInputError("广告报告存在重复列。");
  }
  if (required.some((key) => !columns[key] && !(["asin", "sku"].includes(key) && columns[key.toUpperCase()]))) throw new SellfoxSyncInputError("广告报告缺少必需列。");
  const rows = [];
  for (let index = 2; index <= sheet.rowCount; index++) {
    const excelRow = sheet.getRow(index); if (!excelRow.hasValues) continue;
    const raw: SellfoxRow = {};
    for (const [key, column] of Object.entries(columns)) {
      const value = excelRow.getCell(column).value;
      if (value !== null && typeof value === "object" && !(value instanceof Date)) throw new SellfoxSyncInputError("广告报告不接受公式或复合单元格。");
      raw[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    }
    // 赛狐部分报告（如 SB 广告位报告 adSpaceReport）将日期写为 yyyyMMdd（如 20261019），
    // 统一规范化为 yyyy-MM-dd 后再做契约校验与入库；原有 yyyy-MM-dd 报告保持兼容。
    const rawDate = raw["日期"];
    if (typeof rawDate === "number" && Number.isInteger(rawDate) && /^\d{8}$/.test(String(rawDate))) {
      const text = String(rawDate);
      raw["日期"] = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    } else if (typeof rawDate === "string" && /^\d{8}$/.test(rawDate)) {
      raw["日期"] = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    }
    const reportDate = String(raw["日期"] ?? "");
    if (!isSellfoxDate(reportDate) || reportDate < input.startDate || reportDate > input.endDate || raw["店铺"] !== input.storeName) throw new SellfoxSyncInputError("广告报告日期或店铺不匹配。");
    rows.push(raw);
  }
  return { rows, columns };
}
/** Verified SP/SB and empty SD adProductReport XLSX 2026-10-25. Currency stays null. */
export async function parseSellfoxAdProductReport(buffer: Buffer, input: { storeName: string; startDate: string; endDate: string }) {
  const { rows: rawRows } = await readSellfoxAdReport(buffer, input, required);
  const rows = []; const identities = new Set<string>();
  for (const raw of rawRows) {
    const reportDate = String(raw["日期"]);
    const campaignId = String(raw["广告活动ID"] ?? ""), adGroupId = String(raw["广告组ID"] ?? ""), productId = String(raw["广告产品ID"] ?? "");
    if (!campaignId || !adGroupId || !productId) throw new SellfoxSyncInputError("广告报告缺少稳定实体 ID。");
    const identity = JSON.stringify([reportDate, campaignId, adGroupId, productId]);
    if (identities.has(identity)) throw new SellfoxSyncInputError("广告报告重复实体日期。");
    identities.add(identity);
    rows.push({ reportDate, campaignId, adGroupId, productId, asin: String(raw.asin ?? raw.ASIN ?? "") || null, msku: String(raw.sku ?? raw.SKU ?? "") || null, currency: null,
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
