import { createHash } from "node:crypto";
import { digest } from "./approval-policy";
import { SyncInputError } from "./policy";
import { financeWindowFromFrozen, type FinanceWindow } from "./finance";

/** Reports v2021-06-30. This allowlist covers FBA warehouse-received returns only.
 * https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba#fba-returns-report
 * https://developer-docs.amazon.com/sp-api/docs/retrieve-a-report
 * Not a restricted report type; no Orders RDT assumption is applied here.
 */
export const returnReportTypes = { FBA_RECEIVED: "GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA" } as const;
export type ReturnPolicy = {
  reportType: typeof returnReportTypes.FBA_RECEIVED; initialFrom: string; windowMinutes: number; overlapSeconds: number; safetyLagSeconds: number;
  marketplaceTimeZone: string; applicationId: string; batchSize: number; maxRows: number;
  pollMaxAttempts: number; pollDeadlineMinutes: number; pollBaseSeconds: number; pollMaxSeconds: number;
  budgets: Record<"createReport" | "getReport" | "getReportDocument", { requestsPerSecond: number; burst: number }>;
};
const bad = (): never => { throw new SyncInputError("退货报告或策略格式无效；未回显原始内容。"); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : bad();
const integer = (v: unknown, min: number, max: number): number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : bad();
const identifier = (v: unknown, optional = false): string | null => v === "" && optional ? null : typeof v === "string" && v.length > 0 && v.length <= 500 && !/[\x00-\x20\x7f]/.test(v) ? v : bad();
const reportLabel = (v: string): string | null => v === "" ? null : v.length <= 500 && !/[\x00-\x1f\x7f]/.test(v) ? v : bad();
export function returnTimestamp(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return bad();
  const d = new Date(value), day = new Date(value.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return bad();
  return d;
}
export function parseReturnPolicy(value: unknown): ReturnPolicy {
  const p = object(value);
  if (p.reportType !== returnReportTypes.FBA_RECEIVED || typeof p.initialFrom !== "string" || !p.initialFrom.endsWith("Z")) return bad();
  const initialFrom = returnTimestamp(p.initialFrom).toISOString();
  const windowMinutes = integer(p.windowMinutes, 2, 43200), overlapSeconds = integer(p.overlapSeconds, 1, 2591999);
  if (overlapSeconds >= windowMinutes * 60) return bad();
  if (typeof p.marketplaceTimeZone !== "string" || p.marketplaceTimeZone.length > 100 || typeof p.applicationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(p.applicationId)) return bad();
  try { new Intl.DateTimeFormat("en", { timeZone: p.marketplaceTimeZone }).format(); } catch { return bad(); }
  const budgets = {} as ReturnPolicy["budgets"], b = object(p.budgets);
  for (const [operation, limit] of [["createReport", .0167], ["getReport", 2], ["getReportDocument", .0167]] as const) {
    const row = object(b[operation]);
    if (typeof row.requestsPerSecond !== "number" || !Number.isFinite(row.requestsPerSecond) || row.requestsPerSecond <= 0 || row.requestsPerSecond > limit) return bad();
    budgets[operation] = { requestsPerSecond: row.requestsPerSecond, burst: integer(row.burst, 1, 15) };
  }
  const pollBaseSeconds = integer(p.pollBaseSeconds, 1, 3600), pollMaxSeconds = integer(p.pollMaxSeconds, pollBaseSeconds, 3600);
  return { reportType: p.reportType, initialFrom, windowMinutes, overlapSeconds, safetyLagSeconds: integer(p.safetyLagSeconds, 86400, 2592000), marketplaceTimeZone: p.marketplaceTimeZone, applicationId: p.applicationId,
    batchSize: integer(p.batchSize, 1, 500), maxRows: integer(p.maxRows, 1, 50000), pollMaxAttempts: integer(p.pollMaxAttempts, 1, 100), pollDeadlineMinutes: integer(p.pollDeadlineMinutes, 1, 1440), pollBaseSeconds, pollMaxSeconds, budgets };
}
export function assertReturnRoles(auth: { approvedRoles: string[]; rolesAttestedAt: Date | null }, automaticRead = false) {
  // API capabilities are enforced by Amazon. Member permissions live in account settings.
  // Keep the legacy signature for stored callers; role attestations are metadata only.
  void auth; void automaticRead;
}
export const returnWindowFromFrozen = financeWindowFromFrozen;
export function returnCursorDigest(cursor: { id: string; activeRunId: string | null; status: string; watermarkFrom: Date; watermarkTo: Date; reportStateCiphertext: string | null; detailPolicyDigest: string | null }) {
  return digest({ id: cursor.id, activeRunId: cursor.activeRunId, status: cursor.status, watermarkFrom: cursor.watermarkFrom.toISOString(), watermarkTo: cursor.watermarkTo.toISOString(), reportStateCiphertext: cursor.reportStateCiphertext, detailPolicyDigest: cursor.detailPolicyDigest });
}
/** Amazon metadata can truncate request milliseconds to whole seconds. */
export function reportTimestampMatches(value: unknown, expected: string): boolean {
  if (typeof value !== "string") return false;
  const actual = Date.parse(value), requested = Date.parse(expected);
  return Number.isFinite(actual) && Number.isFinite(requested) &&
    (actual === requested || (actual % 1000 === 0 && actual === Math.floor(requested / 1000) * 1000));
}
export function nextReturnWindow(policy: ReturnPolicy, cursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null, now: Date): FinanceWindow {
  if (cursor && cursor.status !== "SUCCEEDED") return returnWindowFromFrozen({ from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString() });
  const from = cursor ? Math.max(Date.parse(policy.initialFrom), cursor.watermarkTo.getTime() - policy.overlapSeconds * 1000) : Date.parse(policy.initialFrom);
  const to = Math.min(from + policy.windowMinutes * 60_000, now.getTime() - policy.safetyLagSeconds * 1000);
  if (to <= from || (cursor && to <= cursor.watermarkTo.getTime())) throw new SyncInputError("退货窗口尚无可推进的新时间。", 409);
  return returnWindowFromFrozen({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
}
export type ReturnState = { creating?: boolean; reportId?: string; documentId?: string; requestedAt?: string; polls: number; archiveTaskId?: string; offset: number; terminalStatus?: "FATAL" | "CANCELLED" };
export function parseReturnState(text?: string): ReturnState {
  if (!text) return { polls: 0, offset: 0 };
  let p: Record<string, unknown>; try { p = object(JSON.parse(text)); } catch { return bad(); }
  for (const k of ["reportId", "documentId", "archiveTaskId"] as const) if (p[k] !== undefined) identifier(p[k]);
  if (p.requestedAt !== undefined) returnTimestamp(String(p.requestedAt));
  if (p.creating !== undefined && typeof p.creating !== "boolean") return bad();
  integer(p.polls, 0, 100); integer(p.offset, 0, 50000);
  if (p.terminalStatus !== undefined && (!["FATAL", "CANCELLED"].includes(String(p.terminalStatus)) || !p.reportId || p.creating === true || p.documentId !== undefined || p.archiveTaskId !== undefined || p.offset !== 0)) return bad();
  return p as ReturnState;
}
/** Only an explicit approved retry may reset a definitively failed report.
 * Pending, ambiguous-create and downloaded archives must retain their identity. */
export function restartTerminalReturnReport(state: ReturnState): ReturnState {
  const validated = parseReturnState(JSON.stringify(state));
  if (!validated.terminalStatus) throw new SyncInputError("退货报告没有已确认的失败终态，不能重新创建。", 409);
  return { polls: 0, offset: 0 };
}
export function returnPollDelay(policy: ReturnPolicy, attempt: number, random = Math.random) { return Math.ceil(Math.min(policy.pollMaxSeconds, policy.pollBaseSeconds * 2 ** Math.min(attempt, 12)) * (1 + random() * .25) * 1000); }

/** RFC-style TSV quoting, BOM, CRLF, embedded tabs/newlines. Bounds also cover
 * ignored columns: private comments are hashed but never projected into facts.
 */
function* tsv(text: string): Generator<string[]> {
  if (Buffer.byteLength(text, "utf8") > 16 * 1024 * 1024 || text.includes("\0")) return bad();
  let row: string[] = [], cell = "", quoted = false, closed = false, touched = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i]; touched = true;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === "\t" || c === "\n" || c === "\r") {
      row.push(cell); cell = ""; closed = false;
      if (row.length > 100) return bad();
      if (c !== "\t") { if (c === "\r" && text[i + 1] === "\n") i++; yield row; row = []; touched = false; }
    } else { if (closed) return bad(); cell += c; }
    if (cell.length > 65536) return bad();
  }
  if (quoted) return bad();
  if (touched || row.length || cell) { row.push(cell); yield row; }
}
export type ReturnRow = { rowHash: string; returnAt: Date; amazonOrderId: string; sellerSku: string; asin: string; fnsku: string | null; quantity: number; fulfillmentCenterId: string | null; disposition: string | null; reasonCode: string | null; rawStatus: string | null };
export function parseReturnReport(text: string, window: FinanceWindow, policy: ReturnPolicy, offset = 0): { rows: ReturnRow[]; total: number; nextOffset: number; complete: boolean } {
  const iter = tsv(text), header = iter.next().value as string[] | undefined;
  // Some marketplace reports omit status; retain unknown as null, never infer it.
  const required = ["return-date", "order-id", "sku", "asin", "quantity", "detailed-disposition", "reason"];
  if (!header || header.length > 100 || new Set(header).size !== header.length || required.some(k => !header.includes(k)) || header.some(k => !/^[a-z][a-z0-9-]{0,99}$/.test(k))) return bad();
  const rows: ReturnRow[] = []; let total = 0;
  for (const fields of iter) {
    if (fields.length !== header.length || ++total > policy.maxRows) return bad();
    const r = Object.fromEntries(header.map((k, i) => [k, fields[i]]));
    const date = returnTimestamp(r["return-date"]);
    if (date < new Date(window.from) || date >= new Date(window.to) || !/^[1-9]\d{0,8}$/.test(r.quantity)) return bad();
    const row: ReturnRow = { rowHash: createHash("sha256").update(JSON.stringify(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)))).digest("hex"), returnAt: date,
      amazonOrderId: identifier(r["order-id"])!, sellerSku: typeof r.sku === "string" && r.sku.trim() && r.sku.length <= 500 && !/[\x00-\x1f\x7f]/.test(r.sku) ? r.sku : bad(), asin: identifier(r.asin)!, fnsku: identifier(r.fnsku ?? "", true), quantity: Number(r.quantity),
      fulfillmentCenterId: identifier(r["fulfillment-center-id"] ?? "", true), disposition: reportLabel(r["detailed-disposition"]), reasonCode: reportLabel(r.reason), rawStatus: reportLabel(r.status ?? "") };
    if (total > offset && rows.length < policy.batchSize) rows.push(row);
  }
  if (offset > total) return bad();
  return { rows, total, nextOffset: offset + rows.length, complete: offset + rows.length === total };
}
