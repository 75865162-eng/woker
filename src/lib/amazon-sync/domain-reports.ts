import { inventoryReportTypes, isInventoryReport, parseInventoryReport } from "./inventory-report-contracts";
import { longTermStorageFeeRunWindow, type LongTermStorageFeeWindow } from "./long-term-storage-fees";
import { createHash } from "node:crypto";
import { isInventoryAgeBucket } from "./report-business-fields";
import { SyncInputError } from "./policy";
import { digest } from "./approval-policy";

/** Amazon Reports 2021-06-30 types reviewed against the official report catalog.
 * Settlement is discover-only; the two FBA reports are request-only.
 */
export const domainReportTypes = {
  ...inventoryReportTypes,
  fba_shipments: "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL",
  fba_customer_sales: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
  mfn_returns: "GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE",
  settlements: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
  reimbursements: "GET_FBA_REIMBURSEMENTS_DATA",
  inventory_age: "GET_FBA_INVENTORY_PLANNING_DATA",
  inventory_events: "GET_LEDGER_DETAIL_VIEW_DATA",
  removal_order_report: "GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA",
  removal_shipment_report: "GET_FBA_FULFILLMENT_REMOVAL_SHIPMENT_DETAIL_DATA",
  long_term_storage_fees: "GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA",
} as const;
export type DomainReportResource = keyof typeof domainReportTypes;
export function isRemovalReport(resource: string): resource is "removal_order_report" | "removal_shipment_report" {
  return resource === "removal_order_report" || resource === "removal_shipment_report";
}
export type InventoryEventWindow = { from: string; to: string; dataStartTime: string; dataEndTime: string; eventType: string };
export type ReimbursementWindow = { from: string; to: string; dataStartTime: string; dataEndTime: string };
export type RemovalOrderWindow = { from: string; to: string; dataStartTime: string; dataEndTime: string };
export type FbaShipmentsWindow = { from: string; to: string; dataStartTime: string; dataEndTime: string };
export type MfnReturnsWindow = { from: string; to: string; dataStartTime: string; dataEndTime: string };
export type SettlementDiscoveryWindow = { createdSince: string; createdUntil: string; retentionGap?: { from: string; to: string; reason: "QUEUE_MARGIN"; complete: false } };
export type DomainReportWindow = SettlementDiscoveryWindow | InventoryEventWindow | ReimbursementWindow | RemovalOrderWindow | FbaShipmentsWindow | MfnReturnsWindow | LongTermStorageFeeWindow;

export function domainReportHistoryCursorDigest(cursor: { id: string; activeRunId: string | null; status: string; watermarkFrom: Date; watermarkTo: Date; reportStateCiphertext: string | null }) {
  return digest({ id: cursor.id, activeRunId: cursor.activeRunId, status: cursor.status, watermarkFrom: cursor.watermarkFrom.toISOString(), watermarkTo: cursor.watermarkTo.toISOString(), reportStateCiphertext: cursor.reportStateCiphertext });
}

export function mfnReturnsRunWindow(value: unknown, now = new Date()): MfnReturnsWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("MFN 退货报告须提供明确日期范围。", 422);
  const row = value as Record<string, unknown>, from = isoDate(row.from), to = isoDate(row.to);
  const latest = shiftUtcDate(now.toISOString().slice(0, 10), -1);
  if (!from || !to || from > to || to > latest || Date.parse(to) - Date.parse(from) > 59 * 86_400_000) throw new SyncInputError("MFN 退货报告最多查询 60 个已闭合 UTC 日期。", 422);
  const window = { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z` };
  if ((row.dataStartTime !== undefined && row.dataStartTime !== window.dataStartTime) || (row.dataEndTime !== undefined && row.dataEndTime !== window.dataEndTime)) throw new SyncInputError("MFN 退货报告时间戳与日期范围不一致。", 422);
  return window;
}

/** A frozen window describes coverage, not permission to change an old cursor. */
export function reimbursementRunWindow(value: unknown, now = new Date()): ReimbursementWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("赔偿报告须提供明确的日期范围。");
  const row = value as Record<string, unknown>, from = isoDate(row.from), to = isoDate(row.to);
  const yesterday = shiftUtcDate(now.toISOString().slice(0, 10), -1);
  if (!from || !to || from > to || to > yesterday || Date.parse(to) - Date.parse(from) > 29 * 86_400_000) throw new SyncInputError("赔偿报告每次最多 30 个已闭合 UTC 日期。");
  const window = { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z` };
  if ((row.dataStartTime !== undefined && row.dataStartTime !== window.dataStartTime) || (row.dataEndTime !== undefined && row.dataEndTime !== window.dataEndTime)) throw new SyncInputError("赔偿报告时间戳与日期范围不一致。");
  return window;
}

export function removalOrderRunWindow(value: unknown, now = new Date()): RemovalOrderWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("移除报告须提供日期范围。");
  const row = value as Record<string, unknown>, from = isoDate(row.from), to = isoDate(row.to);
  const yesterday = shiftUtcDate(now.toISOString().slice(0, 10), -1);
  if (!from || !to || from !== to || to > yesterday) throw new SyncInputError("移除报告仅接受单个已闭合 UTC 日期；历史保留范围尚未确认。");
  const window = { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z` };
  if ((row.dataStartTime !== undefined && row.dataStartTime !== window.dataStartTime) || (row.dataEndTime !== undefined && row.dataEndTime !== window.dataEndTime)) throw new SyncInputError("移除报告时间戳与日期范围不一致。");
  return window;
}

export function fbaShipmentsRunWindow(value: unknown, now = new Date()): FbaShipmentsWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("FBA 发货报告须提供日期范围。", 422);
  const row = value as Record<string, unknown>, from = isoDate(row.from), to = isoDate(row.to);
  const latest = shiftUtcDate(now.toISOString().slice(0, 10), -2);
  if (!from || !to || from > to || to > latest || Date.parse(to) - Date.parse(from) > 29 * 86_400_000) throw new SyncInputError("FBA 发货报告每次最多 30 个已闭合 UTC 日期，并预留 24 小时数据延迟。", 422);
  const window = { from, to, dataStartTime: `${from}T00:00:00Z`, dataEndTime: `${to}T23:59:59Z` };
  if ((row.dataStartTime !== undefined && row.dataStartTime !== window.dataStartTime) || (row.dataEndTime !== undefined && row.dataEndTime !== window.dataEndTime)) throw new SyncInputError("FBA 发货报告时间戳与日期范围不一致。", 422);
  return window;
}

export function assertSettlementDiscoveryAvailable(window: SettlementDiscoveryWindow, now: Date) {
  if (Date.parse(window.createdSince) <= now.getTime() - 90 * 86_400_000 || Date.parse(window.createdUntil) > now.getTime()) throw new SyncInputError("SETTLEMENT_DISCOVERY_EXPIRED：冻结窗口已超出 getReports 最近 90 天边界，须审阅截断区间后重新申请；原窗口和分页令牌保留。", 409);
}

/** Preserve upstream terminal status without publishing a diagnostic document. */
export function assertDomainReportReady(status: unknown, documentId: unknown) {
  if (status === "FATAL") throw new SyncInputError("REPORT_FATAL：Amazon 报告生成失败；请核实账号报告权限和申请日期，保留报告 ID，不自动重建。", 422);
  if (status === "CANCELLED") throw new SyncInputError("REPORT_CANCELLED：Amazon 已取消报告；保留原任务及检查点。", 422);
  if (status !== "DONE" || typeof documentId !== "string" || !documentId.trim()) throw new SyncInputError("REPORT_DOCUMENT_UNAVAILABLE：报告尚未完成或缺少文档 ID。", 422);
}

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
  currencySource?: string | null;
  currencySourceRowNumber?: number | null;
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
  "settlement-id", "settlement-start-date", "settlement-end-date", "deposit-date", "posted-date", "posted-date-time", "marketplace-name", "marketplace-id",
  "transaction-type", "order-id", "amazon-order-id", "merchant-order-id", "adjustment-id",
  "shipment-id", "marketplace-name", "marketplace-id", "amount-type", "amount-description",
  "amount", "amount-per-unit", "total-amount", "currency", "currency-unit", "currency-code", "sku", "seller-sku",
  "asin", "fnsku", "fulfillment-center-id", "quantity-purchased", "quantity-reimbursed-total",
  "quantity", "approval-date", "reimbursement-id", "reason", "reason-code", "amount-total",
  "quantity-reimbursed-cash", "quantity-reimbursed-inventory", "original-reimbursement-id", "original-reimbursement-type",
  "snapshot-date", "condition", "inventory-age-0-to-90-days", "inventory-age-91-to-180-days",
  "inventory-age-181-to-330-days", "inventory-age-331-to-365-days", "inventory-age-366-plus-days",
  "inv-age-0-to-90-days", "inv-age-91-to-180-days", "inv-age-181-to-270-days",
  "inv-age-271-to-365-days", "inv-age-365-plus-days", "available", "pending-removal-quantity",
  "units-shipped-last-30-days", "units-shipped-last-90-days",
  "date", "date-and-time", "request-date", "last-updated-date", "shipment-date", "item-price-per-unit", "fnsku", "msku", "title", "event-type", "reference-id", "quantity",
  "fulfillment-center", "disposition", "reason", "country", "reconciled-quantity", "unreconciled-quantity", "location", "store",
  "order-source", "order-type", "service-speed", "order-status", "requested-quantity", "cancelled-quantity", "disposed-quantity", "shipped-quantity", "in-process-quantity", "removal-fee",
]);
const requiredHeaders: Record<Exclude<DomainReportResource, keyof typeof inventoryReportTypes>, readonly string[]> = {
  fba_customer_sales: ["shipment-date", "sku", "quantity", "amazon-order-id"],
  mfn_returns: ["return-request-date", "order-id", "return-quantity"],
  fba_shipments: ["amazon-order-id", "shipment-id", "shipment-item-id", "shipment-date", "sku", "quantity-shipped"],
  settlements: ["settlement-start-date", "amount-type", "amount-description", "amount"],
  reimbursements: ["approval-date"],
  inventory_age: ["snapshot-date"],
  inventory_events: ["date", "event-type", "quantity"],
  removal_order_report: ["request-date", "order-id"],
  removal_shipment_report: ["request-date", "shipment-date", "order-id", "shipped-quantity"],
  long_term_storage_fees: ["snapshot-date", "sku", "fnsku", "asin", "qty-charged", "amount-charged", "currency"],
};
const identityHeaders: Record<Exclude<DomainReportResource, keyof typeof inventoryReportTypes>, readonly string[][]> = {
  fba_customer_sales: [["amazon-order-id", "sku"]],
  mfn_returns: [["order-id", "order-item-id"], ["amazon-rma-id"], ["merchant-rma-id"]],
  fba_shipments: [["shipment-id", "shipment-item-id"]],
  settlements: [["settlement-id"], ["transaction-type"]],
  reimbursements: [["reimbursement-id"], ["amazon-order-id"], ["order-id"], ["sku"], ["seller-sku"], ["asin"]],
  inventory_age: [["sku"], ["seller-sku"], ["asin"]],
  inventory_events: [["fnsku"], ["msku"], ["asin"]],
  removal_order_report: [["order-id", "sku"], ["order-id", "fnsku"]],
  removal_shipment_report: [["order-id", "sku"], ["order-id", "fnsku"]],
  long_term_storage_fees: [["sku", "fnsku", "asin"]],
};
const factHeaders: Record<Exclude<DomainReportResource, keyof typeof inventoryReportTypes>, readonly string[]> = {
  fba_customer_sales: ["quantity"],
  mfn_returns: ["return-quantity", "refunded-amount", "label-cost"],
  fba_shipments: ["quantity-shipped"],
  settlements: ["amount", "total-amount"],
  reimbursements: ["amount", "amount-total", "amount-per-unit", "quantity-reimbursed-total"],
  inventory_age: ["inv-age-0-to-90-days", "inv-age-91-to-180-days", "inv-age-181-to-270-days", "inv-age-271-to-365-days", "inv-age-365-plus-days", "inventory-age-0-to-90-days", "available", "pending-removal-quantity"],
  inventory_events: ["quantity", "reconciled-quantity", "unreconciled-quantity"],
  removal_order_report: ["requested-quantity", "cancelled-quantity", "disposed-quantity", "shipped-quantity", "in-process-quantity", "removal-fee"],
  removal_shipment_report: ["shipped-quantity"],
  long_term_storage_fees: ["qty-charged", "amount-charged"],
};

function invalid(): never { throw new SyncInputError("Amazon 报告格式无效或超出安全容量；原件已加密保留。", 422); }

/** Bounded TSV reader with quoted tabs/newlines and escaped quotes. */
export function* readTsv(text: string, options: { ledgerInteriorQuotes?: boolean } = {}): Generator<string[]> {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maxReportBytes || text.includes("\0")) return invalid();
  let cells: string[] = [], cell = "", quoted = false, closed = false, touched = false;
  let ledgerTitleColumn = -1, headerRead = false;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i]; touched = true;
    if (quoted) {
      if (char === '"') {
        // Real Detailed View reports wrap Title in quotes but can leave its
        // interior quotes unescaped, including a quote just before its closing
        // quote. Scope that convention to the Title column discovered in the
        // header; identities, quantities and every other report remain strict.
        if (options.ledgerInteriorQuotes && headerRead && cells.length === ledgerTitleColumn) {
          if (i + 1 === text.length || ["\t", "\r", "\n"].includes(text[i + 1])) { cell = cell.replace(/""/g, '"'); quoted = false; closed = true; }
          else cell += char;
        }
        else if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === "\t" || char === "\r" || char === "\n") {
      cells.push(cell); cell = ""; closed = false;
      if (cells.length > maxColumns) return invalid();
      if (char !== "\t") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        if (!headerRead) { ledgerTitleColumn = cells.findIndex(name => name.trim().toLowerCase() === "title"); headerRead = true; }
        yield cells; cells = []; touched = false;
      }
    } else {
      if (closed) return invalid();
      cell += char;
    }
    if (cell.length > maxCellLength) return invalid();
  }
  if (quoted) return invalid();
  if (touched || cells.length || cell) { cells.push(cell); yield cells; }
}

function businessDate(resource: DomainReportResource, fields: Record<string, string>) {
  const dateField = resource === "settlements" ? "settlement-start-date" : resource === "reimbursements" ? "approval-date" : resource === "inventory_events" ? "date" : resource === "mfn_returns" ? "return-request-date" : resource === "removal_shipment_report" || resource === "fba_shipments" || resource === "fba_customer_sales" ? "shipment-date" : resource === "removal_order_report" ? "request-date" : "snapshot-date";
  const raw = (resource === "settlements" ? fields["posted-date"]?.trim() || fields[dateField]?.trim() : fields[dateField]?.trim()) || null;
  let parsed: string | null = null;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw) parsed = raw;
  else if (resource === "reimbursements" && raw && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(raw)) {
    const day = raw.slice(0, 10);
    if (Number.isFinite(Date.parse(raw)) && new Date(day).toISOString().slice(0, 10) === day) parsed = new Date(raw).toISOString().slice(0, 10);
  }
  else if (resource === "settlements" && raw) {
    // Amazon settlement exports use ISO or day.month.year UTC timestamps.
    const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z| ?UTC|[+-]\d{2}:?\d{2})?)?$/.exec(raw);
    const european = /^(\d{2})\.(\d{2})\.(\d{4})(?: \d{2}:\d{2}:\d{2}(?: UTC)?)?$/.exec(raw);
    const candidate = iso?.[1] ?? (european ? `${european[3]}-${european[2]}-${european[1]}` : null);
    if (candidate && Number.isFinite(Date.parse(candidate)) && new Date(candidate).toISOString().slice(0, 10) === candidate) parsed = candidate;
  }
  else if (resource === "inventory_events" && raw && /^(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{4}$/.test(raw)) {
    const [month, day, year] = raw.split("/").map(Number), candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) parsed = candidate.toISOString().slice(0, 10);
  }
  else if (isRemovalReport(resource) && raw && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) {
    const day = raw.slice(0, 10);
    if (Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day && (!raw.includes("T") || Number.isFinite(Date.parse(raw)))) parsed = day;
  }
  else if ((resource === "fba_shipments" || resource === "fba_customer_sales") && raw && /^\d{4}-\d{2}-\d{2}T.*$/.test(raw)) {
    const day = raw.slice(0, 10);
    if (Number.isFinite(Date.parse(raw)) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day) parsed = day;
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
export function parseDomainReport(resource: DomainReportResource, text: string, options: { offset?: number; limit?: number; inventoryEventWindow?: InventoryEventWindow; reimbursementWindow?: ReimbursementWindow; removalOrderWindow?: RemovalOrderWindow; fbaShipmentsWindow?: FbaShipmentsWindow; mfnReturnsWindow?: MfnReturnsWindow; storageFeeWindow?: LongTermStorageFeeWindow } = {}): NormalizedDomainReport {
  const iterator = readTsv(text, { ledgerInteriorQuotes: resource === "inventory_events" });
  if (isInventoryReport(resource)) return parseInventoryReport(resource, iterator, options);
  const first = iterator.next();
  const sourceHeaders: string[] | undefined = first.value?.map((value: string) => value.replace(/^\uFEFF/, "").trim());
  const headers: string[] | undefined = (isRemovalReport(resource) || resource === "long_term_storage_fees") ? sourceHeaders : sourceHeaders?.map(value => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  if (first.done || !headers?.length || headers.length > maxColumns || headers.some(name => !name || name.length > 200 || /[\x00-\x1f\x7f]/.test(name)) || new Set(headers).size !== headers.length) return invalid();
  const facts = resource === "inventory_age" ? [...factHeaders[resource], ...headers.filter(isInventoryAgeBucket)] : factHeaders[resource];
  if (!requiredHeaders[resource].every((name: string) => headers.includes(name)) || !identityHeaders[resource].some(group => group.every(name => headers.includes(name))) || !facts.some(name => headers.includes(name))) return invalid();
  const reportRows: NormalizedDomainReportRow[] = [];
  const settlementCurrencies = new Map<string, Set<string>>();
  const settlementHeaders = new Map<string, { currency: string; rowNumber: number }[]>();
  let rowNumber = 0;
  for (const cells of iterator) {
    if (++rowNumber > maxRows || cells.length !== headers.length) return invalid();
    const fields = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    const date = businessDate(resource, fields);
    if ((date.raw !== null && !date.parsed) || !identityHeaders[resource].some(group => group.every(name => optional(fields, name) !== null))) return invalid();
    if (!facts.some(name => optional(fields, name) !== null)) return invalid();
    if (resource === "reimbursements" && options.reimbursementWindow && (!date.parsed || date.parsed < options.reimbursementWindow.from || date.parsed > options.reimbursementWindow.to)) return invalid();
    if (resource === "fba_customer_sales") {
      const quantity = optional(fields, "quantity");
      if (!date.parsed || !quantity || !/^\d+$/.test(quantity) || !optional(fields, "amazon-order-id") || !optional(fields, "sku")) return invalid();
      for (const name of ["item-price-per-unit", "shipping-price", "gift-wrap-price"]) {
        const amount = optional(fields, name);
        if (amount !== null && !/^-?\d+(?:\.\d+)?$/.test(amount)) return invalid();
      }
    }
    if (resource === "mfn_returns") {
      const quantity = optional(fields, "return-quantity");
      if (!date.parsed || !quantity || !/^\d+$/.test(quantity) || !optional(fields, "order-id") || !optional(fields, "asin", "merchant-sku") || options.mfnReturnsWindow && (date.parsed < options.mfnReturnsWindow.from || date.parsed > options.mfnReturnsWindow.to)) return invalid();
      for (const name of ["label-cost", "order-amount", "refunded-amount", "safe-t-claim-reimbursement-amount"]) {
        const amount = optional(fields, name);
        if (amount !== null && !/^-?\d+(?:\.\d+)?$/.test(amount)) return invalid();
      }
    }
    if (resource === "fba_shipments") {
      const quantity = optional(fields, "quantity-shipped");
      if (!date.parsed || !quantity || !/^\d+$/.test(quantity) || !optional(fields, "amazon-order-id") || !optional(fields, "shipment-id") || !optional(fields, "shipment-item-id") || !optional(fields, "sku")) return invalid();
      if (options.fbaShipmentsWindow && (date.parsed < options.fbaShipmentsWindow.from || date.parsed > options.fbaShipmentsWindow.to)) return invalid();
      for (const name of ["item-price", "item-tax", "shipping-price", "shipping-tax", "gift-wrap-price", "gift-wrap-tax", "item-promotion-discount", "ship-promotion-discount"]) {
        const amount = optional(fields, name);
        if (amount !== null && !/^-?\d+(?:\.\d+)?$/.test(amount)) return invalid();
      }
    }
    if (resource === "inventory_events") {
      const quantity = optional(fields, "quantity");
      if (!quantity || !/^-?\d{1,9}$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || !optional(fields, "event-type")) return invalid();
      const parsedDate = date.parsed;
      if (!parsedDate || (options.inventoryEventWindow && (parsedDate < options.inventoryEventWindow.from || parsedDate > options.inventoryEventWindow.to))) return invalid();
    }
    if (isRemovalReport(resource)) {
      for (const name of ["requested-quantity", "cancelled-quantity", "disposed-quantity", "shipped-quantity", "in-process-quantity"]) {
        const value = optional(fields, name);
        if (value !== null && !/^\d+$/.test(value)) return invalid();
      }
      const fee = optional(fields, "removal-fee");
      if (fee !== null && !/^-?\d+(?:\.\d+)?$/.test(fee)) return invalid();
      if (!date.parsed || !optional(fields, "order-id") || !optional(fields, "sku", "seller-sku", "fnsku")) return invalid();
      if (resource === "removal_order_report" && options.removalOrderWindow && (date.parsed < options.removalOrderWindow.from || date.parsed > options.removalOrderWindow.to)) return invalid();
    }
    if (resource === "long_term_storage_fees") {
      if (!date.parsed || !/^\d+$/.test(fields["qty-charged"]) || !/^-?\d+(?:\.\d+)?$/.test(fields["amount-charged"]) || !/^[A-Z]{3}$/.test(fields.currency)) return invalid();
      for (const name of ["per-unit-volume", "rate-surcharge"]) {
        const value = optional(fields, name);
        if (value !== null && !/^\d+(?:\.\d+)?$/.test(value)) return invalid();
      }
      if (options.storageFeeWindow && (date.parsed < options.storageFeeWindow.from || date.parsed > options.storageFeeWindow.to)) return invalid();
    }
    const amount = resource === "long_term_storage_fees" ? optional(fields, "amount-charged") : resource === "settlements" ? optional(fields, "amount") : resource === "removal_order_report" ? optional(fields, "removal-fee") : resource === "fba_shipments" ? optional(fields, "item-price") : resource === "fba_customer_sales" ? optional(fields, "item-price-per-unit") : resource === "mfn_returns" ? optional(fields, "refunded-amount", "label-cost") : optional(fields, "amount", "amount-total", "total-amount", "amount-per-unit");
    const currency = optional(fields, "currency", "currency-unit", "currency-code");
    if (resource === "settlements") {
      const settlementId = optional(fields, "settlement-id");
      if (settlementId && currency) {
        const currencies = settlementCurrencies.get(settlementId) ?? new Set<string>();
        currencies.add(currency); settlementCurrencies.set(settlementId, currencies);
        if (/^[A-Z]{3}$/.test(currency) && optional(fields, "total-amount") !== null && !optional(fields, "transaction-type", "amount", "order-id", "amazon-order-id")) {
          const entries = settlementHeaders.get(settlementId) ?? [];
          entries.push({ currency, rowNumber }); settlementHeaders.set(settlementId, entries);
        }
      }
    }
    const rowHash = createHash("sha256").update(JSON.stringify(headers.map(header => [header, fields[header]]))).digest("hex");
    if (rowNumber <= (options.offset ?? 0) || (options.limit !== undefined && reportRows.length >= options.limit)) continue;
    const safeFields = isRemovalReport(resource) || resource === "long_term_storage_fees" ? fields : Object.fromEntries(headers.filter((header: string) => safeFieldNames.has(header) || resource === "inventory_age" && isInventoryAgeBucket(header) || resource === "mfn_returns" && ["order-id", "order-date", "return-request-date", "return-request-status", "asin", "merchant-sku", "item-name", "return-quantity", "return-reason", "in-policy", "is-prime", "return-type", "resolution", "return-delivery-date", "order-amount", "order-quantity", "refunded-amount", "label-cost", "currency-code", "label-type", "a-to-z-claim", "safe-t-action-reason", "safe-t-claim-state", "safe-t-claim-reimbursement-amount"].includes(header) || resource === "fba_shipments" && ["amazon-order-id", "shipment-id", "shipment-item-id", "amazon-order-item-id", "merchant-order-item-id", "purchase-date", "payments-date", "shipment-date", "reporting-date", "sku", "product-name", "quantity-shipped", "currency", "item-price", "item-tax", "shipping-price", "shipping-tax", "gift-wrap-price", "gift-wrap-tax", "ship-service-level", "item-promotion-discount", "ship-promotion-discount", "carrier", "tracking-number", "estimated-arrival-date", "fulfillment-center-id", "fulfillment-channel", "sales-channel", "points-granted"].includes(header) || resource === "fba_customer_sales" && ["shipment-date", "sku", "fnsku", "asin", "fulfillment-center-id", "quantity", "amazon-order-id", "currency", "item-price-per-unit", "shipping-price", "gift-wrap-price", "points-granted"].includes(header)).map((header: string) => [header, fields[header]]));
    reportRows.push({
      rowNumber, rowHash, businessDateRaw: date.raw, businessDate: date.parsed,
      orderId: optional(fields, "order-id", "amazon-order-id"), sellerSku: optional(fields, "sku", "seller-sku", ...(resource === "mfn_returns" ? ["merchant-sku"] : []), ...(resource === "inventory_events" ? ["msku"] : [])), asin: optional(fields, "asin"),
      transactionType: optional(fields, "transaction-type", "event-type", "order-type", ...(resource === "fba_shipments" ? ["fulfillment-channel"] : [])), amountType: optional(fields, "amount-type"), amountDescription: optional(fields, "amount-description", "return-reason", "reason", "disposition"), amountOriginal: amount, currencyCode: currency, quantityOriginal: optional(fields, ...(resource === "long_term_storage_fees" ? ["qty-charged"] : []), ...(resource === "mfn_returns" ? ["return-quantity"] : []), "quantity-shipped", "quantity", "quantity-purchased", "quantity-reimbursed-total", ...(resource === "inventory_events" ? ["quantity", "reconciled-quantity", "unreconciled-quantity"] : isRemovalReport(resource) ? ["requested-quantity", "shipped-quantity"] : [])), fields: safeFields,
    });
  }
  if (resource === "settlements") for (const row of reportRows) {
    row.currencySource = row.currencyCode ? "ROW" : null;
    row.currencySourceRowNumber = row.currencyCode ? row.rowNumber : null;
    if (row.currencyCode) continue;
    const settlementId = row.fields["settlement-id"]?.trim();
    const header = settlementId ? settlementHeaders.get(settlementId) : undefined;
    // Explicit same-settlement header currency only. Multiple headers, missing
    // identities or conflicting currency anywhere in the file stay unresolved.
    if (!settlementId || header?.length !== 1 || settlementCurrencies.get(settlementId)?.size !== 1) continue;
    row.currencyCode = header[0].currency;
    row.currencySource = "SETTLEMENT_HEADER";
    row.currencySourceRowNumber = header[0].rowNumber;
  }
  return { headers, rows: reportRows, rowCount: rowNumber, dateField: businessDate(resource, {}).dateField };
}

export function reportDomainRoles(resource: DomainReportResource): string[] {
  return resource === "fba_shipments" ? ["Pricing", "Amazon Fulfillment", "Inventory and Order Tracking"] : resource === "mfn_returns" ? ["Inventory and Order Tracking", "Direct to Consumer Shipping (Restricted)"] : resource === "fba_customer_sales" || resource === "fba_overage_fees" ? ["Amazon Fulfillment"] : isInventoryReport(resource) ? resource === "fba_fulfilled_inventory" ? ["Amazon Fulfillment"] : ["Pricing", "Amazon Fulfillment"] : resource === "settlements" ? ["Finance and Accounting"] : resource === "reimbursements" || resource === "long_term_storage_fees" || isRemovalReport(resource) ? ["Pricing", "Amazon Fulfillment"] : ["Amazon Fulfillment"];
}

export function assertDomainReportRoles(resource: DomainReportResource, auth: { approvedRoles: string[]; rolesAttestedAt: Date | null }, automaticRead = false) {
  // API capabilities are enforced by Amazon. Member permissions live in account settings.
  // Keep the legacy signature for stored callers; role attestations are metadata only.
  if ((isInventoryReport(resource) || resource === "fba_shipments" || resource === "fba_customer_sales" || resource === "mfn_returns" || resource === "long_term_storage_fees" || isRemovalReport(resource)) && (!auth.rolesAttestedAt || !auth.approvedRoles.some(role => reportDomainRoles(resource).includes(role)))) throw new SyncInputError("BLOCKED_ROLE：报告所需角色须先核验；账号资格由 Amazon 响应核验。", 403);
  void automaticRead;
}

export function parseGetReportsPage(value: unknown, expectedType: string, marketplaceId: string, collectionMarketplaceIds?: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const root = value as { reports?: unknown; nextToken?: unknown };
  if (!Array.isArray(root.reports) || root.reports.length > 100 || (root.nextToken !== undefined && (typeof root.nextToken !== "string" || !root.nextToken.trim() || root.nextToken.length > 32_000))) return invalid();
  const reports = root.reports.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalid();
    const report = item as Record<string, unknown>;
    if (typeof report.reportId !== "string" || !report.reportId || report.reportId.length > 200 || report.reportType !== expectedType || !Array.isArray(report.marketplaceIds) || !report.marketplaceIds.length || !report.marketplaceIds.includes(marketplaceId)) return invalid();
    if (collectionMarketplaceIds && expectedType === domainReportTypes.settlements) {
      if (report.marketplaceIds.length > 30 || new Set(report.marketplaceIds).size !== report.marketplaceIds.length || report.marketplaceIds.some(id => typeof id !== "string" || !collectionMarketplaceIds.includes(id))) throw new SyncInputError("SETTLEMENT_COLLECTION_SCOPE：结算报告包含未批准采集的站点，未下载原件。", 403);
    } else if (report.marketplaceIds.length !== 1) {
      if (expectedType === domainReportTypes.settlements) throw new SyncInputError("SETTLEMENT_MULTI_MARKETPLACE：结算报告涉及多个站点，须建立卖家级报告唯一归档及明细归属后发布；禁止将整份报告归入当前店铺。", 409);
      return invalid();
    }
    const createdTime = report.createdTime;
    if (createdTime !== undefined && (typeof createdTime !== "string" || !Number.isFinite(Date.parse(createdTime)))) return invalid();
    return { reportId: report.reportId, createdTime: typeof createdTime === "string" ? new Date(createdTime).toISOString() : null };
  });
  if (new Set(reports.map(report => report.reportId)).size !== reports.length) return invalid();
  return { reports, nextToken: typeof root.nextToken === "string" ? root.nextToken : undefined };
}

export function domainReportRunWindow(resource: DomainReportResource, value: unknown, now = new Date()): DomainReportWindow | null {
  if (resource === "fba_shipments") return value == null ? null : fbaShipmentsRunWindow(value, now);
  if (resource === "mfn_returns") return value == null ? null : mfnReturnsRunWindow(value, now);
  if (resource === "inventory_events") return inventoryEventRunWindow(value, now);
  if (resource === "long_term_storage_fees") return value == null ? null : longTermStorageFeeRunWindow(value, now);
  if (isRemovalReport(resource)) return value == null ? null : removalOrderRunWindow(value, now);
  // Legacy unbounded reports may still be polled/downloaded. New task creation
  // requires an explicit window in service.ts; never retrofit an old report.
  if (resource === "reimbursements") return value == null ? null : reimbursementRunWindow(value, now);
  if (resource !== "settlements") return null;
  const range = (value ?? {}) as { createdSince?: unknown; createdUntil?: unknown; retentionGap?: unknown };
  const valid = (date: unknown) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date) && Number.isFinite(Date.parse(date));
  if (!valid(range?.createdSince) || !valid(range?.createdUntil) || Date.parse(range.createdSince as string) >= Date.parse(range.createdUntil as string) || Date.parse(range.createdUntil as string) - Date.parse(range.createdSince as string) > 90 * 24 * 60 * 60_000) throw new SyncInputError("结算报告发现窗口无效；getReports 的日期筛选代表报告创建时间，最多查询 90 天。", 400);
  const result: SettlementDiscoveryWindow = { createdSince: new Date(range.createdSince as string).toISOString(), createdUntil: new Date(range.createdUntil as string).toISOString() };
  if (range.retentionGap !== undefined) {
    if (!range.retentionGap || typeof range.retentionGap !== "object" || Array.isArray(range.retentionGap)) throw new SyncInputError("结算发现缺口无效。");
    const gap = range.retentionGap as Record<string, unknown>;
    if (!valid(gap.from) || !valid(gap.to) || Date.parse(gap.to as string) !== Date.parse(result.createdSince) || Date.parse(gap.from as string) >= Date.parse(gap.to as string) || Date.parse(gap.from as string) < Date.parse(result.createdUntil) - 90 * 86_400_000 || gap.reason !== "QUEUE_MARGIN" || gap.complete !== false) throw new SyncInputError("结算发现缺口与冻结窗口不一致。");
    result.retentionGap = { from: new Date(gap.from as string).toISOString(), to: result.createdSince, reason: "QUEUE_MARGIN", complete: false };
  }
  return result;
}
