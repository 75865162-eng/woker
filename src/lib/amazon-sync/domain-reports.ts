import { createHash } from "node:crypto";
import { SyncInputError } from "./policy";

/** Amazon Reports 2021-06-30 types reviewed against the official report catalog.
 * Settlement is discover-only; the two FBA reports are request-only.
 */
export const domainReportTypes = {
  settlements: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
  reimbursements: "GET_FBA_REIMBURSEMENTS_DATA",
  inventory_age: "GET_FBA_INVENTORY_PLANNING_DATA",
  inventory_events: "GET_LEDGER_DETAIL_VIEW_DATA",
} as const;
export type DomainReportResource = keyof typeof domainReportTypes;
export type InventoryEventWindow = { from: string; to: string; dataStartTime: string; dataEndTime: string; eventType: string };

export type NormalizedDomainReportRow = {
  rowNumber: number;
  rowHash: string;
  businessDateRaw: string | null;
  businessDate: string | null;
  orderId: string | null;
  sellerSku: string | null;
  asin: string | null;
  transactionType: string | null;
  amountType: string | null;
  amountDescription: string | null;
  amountOriginal: string | null;
  currencyCode: string | null;
  quantityOriginal: string | null;
  fields: Record<string, string>;
};

export type NormalizedDomainReport = {
  headers: string[];
  rows: NormalizedDomainReportRow[];
  rowCount: number;
  dateField: string;
};

const maxReportBytes = 16 * 1024 * 1024;
const maxRows = 50_000;
const maxColumns = 100;
const maxCellLength = 65_536;

// Raw report text remains encrypted. Normal query fields use an allowlist so
// newly added report columns cannot accidentally expose buyer or payment PII.
const safeFieldNames = new Set([
  "settlement-id", "settlement-start-date", "settlement-end-date", "deposit-date",
  "transaction-type", "order-id", "amazon-order-id", "merchant-order-id", "adjustment-id",
  "shipment-id", "marketplace-name", "marketplace-id", "amount-type", "amount-description",
  "amount", "amount-per-unit", "total-amount", "currency", "currency-unit", "currency-code", "sku", "seller-sku",
  "asin", "fnsku", "fulfillment-center-id", "quantity-purchased", "quantity-reimbursed-total",
  "quantity", "approval-date", "reimbursement-id", "reason", "reason-code", "amount-total",
  "snapshot-date", "condition", "inventory-age-0-to-90-days", "inventory-age-91-to-180-days",
  "inventory-age-181-to-330-days", "inventory-age-331-to-365-days", "inventory-age-366-plus-days",
  "inv-age-0-to-90-days", "inv-age-91-to-180-days", "inv-age-181-to-270-days",
  "inv-age-271-to-365-days", "inv-age-365-plus-days", "available", "pending-removal-quantity",
  "units-shipped-last-30-days", "units-shipped-last-90-days",
  "date", "date-and-time", "fnsku", "msku", "title", "event-type", "reference-id", "quantity",
  "fulfillment-center", "disposition", "reason", "country", "reconciled-quantity", "unreconciled-quantity", "location", "store",
]);
const requiredHeaders: Record<DomainReportResource, readonly string[]> = {
  settlements: ["settlement-start-date", "amount-type", "amount-description", "amount"],
  reimbursements: ["approval-date"],
  inventory_age: ["snapshot-date"],
  inventory_events: ["date", "event-type", "quantity"],
};
const identityHeaders: Record<DomainReportResource, readonly string[][]> = {
  settlements: [["settlement-id"], ["transaction-type"]],
  reimbursements: [["reimbursement-id"], ["amazon-order-id"], ["order-id"], ["sku"], ["seller-sku"], ["asin"]],
  inventory_age: [["sku"], ["seller-sku"], ["asin"]],
  inventory_events: [["fnsku"], ["msku"], ["asin"]],
};
const factHeaders: Record<DomainReportResource, readonly string[]> = {
  settlements: ["amount", "total-amount"],
  reimbursements: ["amount", "amount-total", "amount-per-unit", "quantity-reimbursed-total"],
  inventory_age: ["inv-age-0-to-90-days", "inv-age-91-to-180-days", "inv-age-181-to-270-days", "inv-age-271-to-365-days", "inv-age-365-plus-days", "inventory-age-0-to-90-days", "available", "pending-removal-quantity"],
  inventory_events: ["quantity", "reconciled-quantity", "unreconciled-quantity"],
};

function invalid(): never { throw new SyncInputError("Amazon 报告格式无效或超出安全容量；原件已加密保留。", 422); }

/** Bounded TSV reader with quoted tabs/newlines and escaped quotes. */
export function* readTsv(text: string): Generator<string[]> {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxReportBytes || text.includes("\0")) return invalid();
  let cells: string[] = [], cell = "", quoted = false, closed = false, touched = false;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i]; touched = true;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === "\t" || char === "\r" || char === "\n") {
      cells.push(cell); cell = ""; closed = false;
      if (cells.length > maxColumns) return invalid();
      if (char !== "\t") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        yield cells; cells = []; touched = false;
      }
    } else {
      if (closed || char === '"') return invalid();
      cell += char;
    }
    if (cell.length > maxCellLength) return invalid();
  }
  if (quoted) return invalid();
  if (touched || cells.length || cell) { cells.push(cell); yield cells; }
}

function businessDate(resource: DomainReportResource, fields: Record<string, string>) {
  const dateField = resource === "settlements" ? "settlement-start-date" : resource === "reimbursements" ? "approval-date" : resource === "inventory_events" ? "date" : "snapshot-date";
  const raw = fields[dateField]?.trim() || null;
  let parsed: string | null = null;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw) parsed = raw;
  else if (resource === "inventory_events" && raw && /^(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4}$/.test(raw)) {
    const [month, day, year] = raw.split("/").map(Number), candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) parsed = candidate.toISOString().slice(0, 10);
  }
  return { dateField, raw, parsed };
}

const inventoryEventTypes = new Set(["", "Adjustments", "CustomerReturns", "Receipts", "Shipments", "VendorReturns", "WhseTransfers"]);
function isoDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
}
function shiftUtcDate(value: string, days: number) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** Detailed Inventory Ledger requests are frozen to a closed, <=31-day window.
 * The conservative 540-day cutoff stays inside Amazon's documented 18-month history.
 */
export function inventoryEventRunWindow(value: unknown, now = new Date()): InventoryEventWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("库存事件报告日期范围无效。");
  const row = value as Record<string, unknown>, from = isoDate(row.from), to = isoDate(row.to), eventType = row.eventType;
  const yesterday = shiftUtcDate(now.toISOString().slice(0, 10), -1);
  if (!from || !to || from > to || to > yesterday || from < shiftUtcDate(yesterday, -539) || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 30 * 86_400_000 || typeof eventType !== "string" || !inventoryEventTypes.has(eventType)) throw new SyncInputError("库存事件每次最多 31 个已闭合日期，且只能查询最近 540 天；事件类型无效。");
  return { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z`, eventType };
}

function optional(fields: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Rows retain the report's exact header names and string values. Decimal/localized
 * amount cells are not parsed or converted. No guessed or derived fields escape.
 */
export function parseDomainReport(resource: DomainReportResource, text: string, options: { offset?: number; limit?: number; inventoryEventWindow?: InventoryEventWindow } = {}): NormalizedDomainReport {
  const iterator = readTsv(text);
  const first = iterator.next();
  const sourceHeaders: string[] | undefined = first.value?.map((value: string) => value.replace(/^\uFEFF/, "").trim());
  const headers: string[] | undefined = sourceHeaders?.map(value => resource === "inventory_events" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : value);
  if (first.done || !headers?.length || headers.length > maxColumns || headers.some(name => !name || name.length > 200 || /[\x00-\x1f\x7f]/.test(name)) || new Set(headers).size !== headers.length) return invalid();
  if (!requiredHeaders[resource].every((name: string) => headers.includes(name)) || !identityHeaders[resource].some(group => group.every(name => headers.includes(name))) || !factHeaders[resource].some(name => headers.includes(name))) return invalid();
  const reportRows: NormalizedDomainReportRow[] = [];
  let rowNumber = 0;
  for (const cells of iterator) {
    if (++rowNumber > maxRows || cells.length !== headers.length) return invalid();
    const fields = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    const date = businessDate(resource, fields);
    if ((date.raw !== null && !date.parsed) || !identityHeaders[resource].some(group => group.every(name => optional(fields, name) !== null))) return invalid();
    if (!factHeaders[resource].some(name => optional(fields, name) !== null)) return invalid();
    if (resource === "inventory_events") {
      const quantity = optional(fields, "quantity");
      if (!quantity || !/^-?\d{1,9}$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || !optional(fields, "event-type")) return invalid();
      const parsedDate = date.parsed;
      if (!parsedDate || (options.inventoryEventWindow && (parsedDate < options.inventoryEventWindow.from || parsedDate > options.inventoryEventWindow.to))) return invalid();
    }
    const amount = optional(fields, "amount", "amount-total", "amount-per-unit");
    const currency = optional(fields, "currency", "currency-unit");
    const rowHash = createHash("sha256").update(JSON.stringify(headers.map(header => [header, fields[header]]))).digest("hex");
    if (rowNumber <= (options.offset ?? 0) || (options.limit !== undefined && reportRows.length >= options.limit)) continue;
    const safeFields = Object.fromEntries(headers.filter((header: string) => safeFieldNames.has(header)).map((header: string) => [header, fields[header]]));
    reportRows.push({
      rowNumber, rowHash, businessDateRaw: date.raw, businessDate: date.parsed,
      orderId: optional(fields, "order-id", "amazon-order-id"), sellerSku: optional(fields, "sku", "seller-sku", ...(resource === "inventory_events" ? ["msku"] : [])), asin: optional(fields, "asin"),
      transactionType: optional(fields, "transaction-type", "event-type"), amountType: optional(fields, "amount-type"), amountDescription: optional(fields, "amount-description", "reason"), amountOriginal: amount, currencyCode: currency, quantityOriginal: optional(fields, "quantity-purchased", "quantity-reimbursed-total", ...(resource === "inventory_events" ? ["quantity", "reconciled-quantity", "unreconciled-quantity"] : [])), fields: safeFields,
    });
  }
  return { headers, rows: reportRows, rowCount: rowNumber, dateField: businessDate(resource, {}).dateField };
}

export function reportDomainRoles(resource: DomainReportResource): string[] {
  return resource === "settlements" ? ["Finance and Accounting"] : resource === "reimbursements" ? ["Pricing", "Amazon Fulfillment"] : ["Amazon Fulfillment"];
}

export function assertDomainReportRoles(resource: DomainReportResource, auth: { approvedRoles: string[]; rolesAttestedAt: Date | null }, automaticRead = false) {
  // Automatic token-scoped reads let Amazon enforce its actual operation role; no attestation is invented.
  if (automaticRead && (!auth.rolesAttestedAt || !auth.approvedRoles.length)) return;
  const roles = reportDomainRoles(resource);
  const valid = resource === "reimbursements" ? roles.some(role => auth.approvedRoles.includes(role)) : roles.every(role => auth.approvedRoles.includes(role));
  if (!auth.rolesAttestedAt || !valid) throw new SyncInputError(`${resource} 数据域所需 Amazon 角色尚未由管理员核实。`, 403);
}

export function parseGetReportsPage(value: unknown, expectedType: string, marketplaceId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const root = value as { reports?: unknown; nextToken?: unknown };
  if (!Array.isArray(root.reports) || root.reports.length > 100 || (root.nextToken !== undefined && (typeof root.nextToken !== "string" || !root.nextToken.trim() || root.nextToken.length > 32_000))) return invalid();
  const reports = root.reports.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalid();
    const report = item as Record<string, unknown>;
    if (typeof report.reportId !== "string" || !report.reportId || report.reportId.length > 200 || report.reportType !== expectedType || !Array.isArray(report.marketplaceIds) || report.marketplaceIds.length !== 1 || report.marketplaceIds[0] !== marketplaceId) return invalid();
    const createdTime = report.createdTime;
    if (createdTime !== undefined && (typeof createdTime !== "string" || !Number.isFinite(Date.parse(createdTime)))) return invalid();
    return { reportId: report.reportId, createdTime: typeof createdTime === "string" ? new Date(createdTime).toISOString() : null };
  });
  if (new Set(reports.map(report => report.reportId)).size !== reports.length) return invalid();
  return { reports, nextToken: typeof root.nextToken === "string" ? root.nextToken : undefined };
}

export function domainReportRunWindow(resource: DomainReportResource, value: unknown): { createdSince: string; createdUntil: string } | InventoryEventWindow | null {
  if (resource === "inventory_events") return inventoryEventRunWindow(value);
  if (resource !== "settlements") return null;
  const range = (value ?? {}) as { createdSince?: unknown; createdUntil?: unknown };
  const valid = (date: unknown) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date) && Number.isFinite(Date.parse(date));
  if (!valid(range?.createdSince) || !valid(range?.createdUntil) || Date.parse(range.createdSince as string) >= Date.parse(range.createdUntil as string) || Date.parse(range.createdUntil as string) - Date.parse(range.createdSince as string) > 90 * 24 * 60 * 60_000) throw new SyncInputError("结算报告发现窗口无效；getReports 的日期筛选代表报告创建时间，最多查询 90 天。", 400);
  return { createdSince: new Date(range.createdSince as string).toISOString(), createdUntil: new Date(range.createdUntil as string).toISOString() };
}
