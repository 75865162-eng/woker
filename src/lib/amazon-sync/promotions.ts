import { createHash } from "node:crypto";
import { parseAmazonBusinessJson } from "./business-data";
import { SyncInputError } from "./policy";
import { observationFact, type SafeFact } from "./observation-parsers";

export const promotionTypes = ["BASKET_BUILDING", "DEAL", "PRICE_DISCOUNT", "COUPON"] as const;
export const promotionStatuses = ["PROCESSING", "UPCOMING", "RUNNING", "EXPIRED", "FAILED", "CANCELLING", "CANCELLED"] as const;
export const promotionsContract = {
  version: "2025-12-01", identity: "SELLER_ACCOUNT_MARKETPLACE", roles: ["Pricing", "Product Listing"], roleMatch: "ANY",
  operations: ["searchPromotions", "getPromotion", "getSelection"], types: promotionTypes, statuses: promotionStatuses,
  pagination: "REPEAT_FILTERS_UNTIL_NO_NEXT_TOKEN_INCLUDING_EMPTY_PAGES", pageSize: 100,
  history: "API_VISIBLE_HISTORY_ONLY_NO_DOCUMENTED_RETENTION_GUARANTEE", updatedFilter: ["updateDateAfter", "updateDateBefore"],
  incremental: "FULL_DISCOVERY_REUSE_UNCHANGED_TERMINAL_DETAILS_RECHECK_ACTIVE_AND_RECENT", recentDays: 30,
  catalogSelection: "RULES_ONLY_NO_GET_SELECTION", feeSemantics: "CREATION_TIME_FEE_RATE_SNAPSHOT_NOT_ACTUAL_SPEND",
  archive: true, parse: true, structuredStorage: true, publish: true,
  accessEligibility: "ATTESTED_ROLE_PLUS_ACTUAL_UPSTREAM_READ_SUCCESS", historyDiscovery: "UNFILTERED_ANY_REVISION_PAGINATION",
  incrementalFilterUse: "NOT_USED_FOR_BASELINE_COMPLETENESS_FULL_SUMMARY_RECONCILIATION", terminalDetailRefreshDays: 7,
  limits: { maxRequests: 1000, maxRows: 50000, maxResponseBytes: 4194304 },
} as const;
export type PromotionSelection = { promotionId: string; revision: "PUBLISHED" | "LATEST"; role: string; selectionId: string; revisionId: string };
export type PromotionsState = {
  stage: "SEARCH" | "DETAIL" | "SELECTION" | "VERIFY" | "COMPLETE";
  ids: string[]; index: number; selections: PromotionSelection[]; selectionIndex: number;
  token?: string; priorTokens: string[]; totalResults?: number; signature?: string; retainedPromotions?: number; context?: Record<string, unknown>;
};
const invalid = (message = "Promotions 响应或分页不完整；保留原发布版本。"): never => { throw new SyncInputError(message, 422); };
export function promotionObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid(); }
export function promotionId(value: unknown): string { return typeof value === "string" && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid(); }
function array(value: unknown): unknown[] { return Array.isArray(value) && value.length <= 50000 ? value : invalid(); }
export function reusablePromotionSummary(previous: unknown, current: unknown, capturedAt: Date, now: Date): boolean {
  const clean = (v: unknown) => Object.fromEntries(Object.entries(promotionObject(v)).filter(([key]) => !["provenance", "observation", "queryDates"].includes(key)));
  const a = clean(previous), b = clean(current);
  if (!["EXPIRED", "FAILED", "CANCELLED"].includes(String(b.status)) || promotionSignature(a) !== promotionSignature(b)) return false;
  const ended = Date.parse(String(promotionObject(b.schedule).endDate));
  return Number.isFinite(ended) && ended < now.getTime() - 30 * 86400000 && capturedAt.getTime() > now.getTime() - 7 * 86400000;
}
export function promotionSignature(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export function assertPromotionSummaryMatchesDetail(summary: unknown, detail: unknown): void {
  const a = promotionObject(summary), b = promotionObject(detail);
  const keys = ["promotionId", "marketplaceId", "promotionType", "status", "promotionTitle", "trackingId", "createdDate", "lastUpdatedDate", "schedule"];
  const core = (p: Record<string, unknown>) => Object.fromEntries(keys.map(key => [key, p[key]]));
  if (promotionSignature(core(a)) !== promotionSignature(core(b))) invalid("促销搜索与详情版本不一致；保留旧发布版本，需重新发现。");
}
export function initialPromotionsState(): PromotionsState { return { stage: "SEARCH", ids: [], index: 0, selections: [], selectionIndex: 0, priorTokens: [] }; }
export function validatePromotionsState(value: unknown): PromotionsState {
  const s = promotionObject(value);
  if (!["SEARCH", "DETAIL", "SELECTION", "VERIFY", "COMPLETE"].includes(String(s.stage)) || !Number.isSafeInteger(s.index) || !Number.isSafeInteger(s.selectionIndex)) return invalid();
  const ids = array(s.ids).map(promotionId), selections = array(s.selections);
  if (new Set(ids).size !== ids.length || Number(s.index) < 0 || Number(s.index) > ids.length || Number(s.selectionIndex) < 0 || Number(s.selectionIndex) > selections.length) return invalid();
  for (const entry of selections) {
    const item = promotionObject(entry);
    if (item.promotionId !== ids[Number(s.index)] || !["PUBLISHED", "LATEST"].includes(String(item.revision)) || !["selection", "purchaseRequirements.selection"].includes(String(item.role)) || !/^[1-9]\d*$/.test(String(item.revisionId))) return invalid();
    promotionId(item.selectionId);
  }
  array(s.priorTokens).forEach(promotionIdToken);
  if (s.token !== undefined) promotionIdToken(s.token);
  if (s.totalResults !== undefined && (!Number.isSafeInteger(s.totalResults) || Number(s.totalResults) < 0)) return invalid();
  if ((s.stage === "COMPLETE") !== (Number(s.index) === ids.length && s.stage !== "SEARCH")) return invalid();
  return s as unknown as PromotionsState;
}
function promotionIdToken(value: unknown): string { return typeof value === "string" && value.length > 0 && value.length <= 32000 ? value : invalid(); }
function nextPage(s: PromotionsState, value: unknown): boolean {
  const token = value === undefined || value === null ? undefined : promotionIdToken(value);
  if (token && (token === s.token || s.priorTokens.includes(token))) return invalid("Promotions 分页令牌循环，不能发布。");
  if (s.token) s.priorTokens.push(s.token);
  s.token = token;
  if (!token) s.priorTokens = [];
  return !!token;
}
export function promotionsRequest(state: PromotionsState, marketplaceId: string): { operation: string; path: string } {
  const root = "/promotions/2025-12-01/promotions";
  const query = new URLSearchParams({ locale: "en_US" });
  if (state.stage === "SEARCH") {
    query.set("marketplaceIds", marketplaceId); query.set("revision", "ANY"); query.set("limit", "100"); query.set("includedData", "ISSUES,CUSTOMER_SEGMENTS");
    if (state.token) query.set("paginationToken", state.token);
    return { operation: "searchPromotions", path: root + "?" + query };
  }
  const id = encodeURIComponent(promotionId(state.ids[state.index]));
  if (state.stage === "DETAIL" || state.stage === "VERIFY") {
    query.set("includedData", "ISSUES,SELECTION,CUSTOMER_SEGMENTS");
    return { operation: "getPromotion", path: root + "/" + id + "?" + query };
  }
  if (state.stage !== "SELECTION") return invalid();
  const selection = state.selections[state.selectionIndex];
  if (!selection || selection.promotionId !== state.ids[state.index]) return invalid();
  query.set("revisionId", selection.revisionId); query.set("limit", "100"); query.set("includedData", "ISSUES");
  if (state.token) query.set("paginationToken", state.token);
  return { operation: "getSelection", path: root + "/" + id + "/selections/" + encodeURIComponent(selection.selectionId) + "?" + query };
}
export function promotionQueryDates(value: Record<string, unknown>) {
  const schedule = promotionObject(value.schedule);
  const utc = (v: unknown) => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
  return { scheduleStartUtc: utc(schedule.startDate), scheduleEndUtc: utc(schedule.endDate), updatedAtUtc: utc(value.lastUpdatedDate) };
}
function verifyPromotion(value: unknown, id: string, marketplaceId: string): Record<string, unknown> {
  const p = promotionObject(value);
  if (p.promotionId !== id || p.marketplaceId !== marketplaceId || !(promotionTypes as readonly unknown[]).includes(p.promotionType)) return invalid();
  for (const key of ["createdDate", "lastUpdatedDate"]) if (typeof p[key] !== "string" || !Number.isFinite(Date.parse(p[key] as string))) return invalid();
  for (const key of ["promotionTitle", "trackingId"]) if (typeof p[key] !== "string") return invalid();
  promotionObject(p.schedule); promotionObject(p.selection);
  return p;
}
export function advancePromotions(raw: string, current: PromotionsState, marketplaceId: string): { state: PromotionsState; rows: SafeFact[] } {
  const root = promotionObject(parseAmazonBusinessJson(raw)), wire = promotionObject(JSON.parse(raw)), s = structuredClone(current), rows: SafeFact[] = [];
  if (s.stage === "SEARCH") {
    const count = Number(root.totalResults);
    if (!/^\d+$/.test(String(root.totalResults)) || !Number.isSafeInteger(count) || count > 50000 || s.totalResults !== undefined && s.totalResults !== count) return invalid();
    s.totalResults = count;
    for (const value of array(root.promotions)) {
      const p = promotionObject(value), id = promotionId(p.promotionId);
      if (p.marketplaceId !== marketplaceId || s.ids.includes(id)) return invalid();
      s.ids.push(id); rows.push(observationFact("PROMOTION_SUMMARY", id, { ...p, queryDates: promotionQueryDates(p) }));
    }
    const pagination = wire.pagination == null ? {} : promotionObject(wire.pagination);
    if (!nextPage(s, pagination.nextToken)) {
      // Amazon documents that successful searches may omit results. Detect the
      // observed gap instead of declaring the returned subset a complete baseline.
      if (s.ids.length !== count) return invalid("Promotions 返回条数与 totalResults 不一致；历史覆盖存在缺口。");
      s.stage = s.ids.length ? "DETAIL" : "COMPLETE";
    }
    return { state: s, rows };
  }
  const id = s.ids[s.index];
  if (s.stage === "DETAIL" || s.stage === "VERIFY") {
    const p = verifyPromotion(root, id, marketplaceId);
    if (!(promotionStatuses as readonly unknown[]).includes(p.status)) return invalid();
    if (s.stage === "VERIFY") {
      if (s.signature !== promotionSignature(p)) return invalid("促销在商品分页期间发生修改；保留旧版本，需重新发现。");
      s.index++; s.selections = []; s.selectionIndex = 0; delete s.signature; delete s.context;
      s.stage = s.index === s.ids.length ? "COMPLETE" : "DETAIL";
      return { state: s, rows };
    }
    s.signature = promotionSignature(p); s.selections = []; s.selectionIndex = 0;
    s.context = { ...Object.fromEntries(["status", "promotionType", "trackingId", "schedule", "lastUpdatedDate"].map(key => [key, p[key]])), queryDates: promotionQueryDates(p) };
    for (const revision of ["PUBLISHED", "LATEST"] as const) {
      const detail = revision === "PUBLISHED" ? p : p.latestRevision === undefined || p.latestRevision === null ? null : verifyPromotion(p.latestRevision, id, marketplaceId);
      if (!detail) continue;
      rows.push(observationFact("PROMOTION", [id, revision], { ...s.context, promotionId: id, revision, promotion: detail }));
      const purchase = detail.purchaseRequirements == null ? null : promotionObject(detail.purchaseRequirements);
      for (const [role, value] of [["selection", detail.selection], ["purchaseRequirements.selection", purchase?.selection]] as const) {
        if (value === undefined || value === null) continue;
        const selection = promotionObject(value);
        if (selection.type === "CATALOG") continue; // Rules/exclusions remain in the complete detail.
        if (selection.type !== "ITEMS" || !/^[1-9]\d*$/.test(String(selection.revisionId))) return invalid();
        s.selections.push({ promotionId: id, revision, role, selectionId: promotionId(selection.selectionId), revisionId: String(selection.revisionId) });
      }
    }
    s.stage = s.selections.length ? "SELECTION" : "VERIFY";
  } else if (s.stage === "SELECTION") {
    const expected = s.selections[s.selectionIndex], selection = promotionObject(root.selection);
    if (!expected || selection.type !== "ITEMS" || selection.selectionId !== expected.selectionId || String(selection.revisionId) !== expected.revisionId) return invalid();
    const details = promotionObject(selection.selectionDetails), pageIdentity = [id, expected.revision, expected.role, expected.selectionId, expected.revisionId, s.token ?? null];
    // Keep the whole page (unknown fields, issues, nulls) alongside item rows.
    rows.push(observationFact("PROMOTION_SELECTION", pageIdentity, { ...s.context, ...expected, selection, response: root }));
    array(details.items ?? []).forEach((value, index) => {
      const item = promotionObject(value);
      if (item.asin === undefined && item.sku === undefined) return invalid();
      rows.push(observationFact("PROMOTION_ITEM", [...pageIdentity, index], { ...s.context, ...expected, item, ...(details.issues === undefined ? {} : { selectionIssues: details.issues }) }, { asin: typeof item.asin === "string" ? item.asin : null, sellerSku: typeof item.sku === "string" ? item.sku : null }));
    });
    const wireDetails = promotionObject(promotionObject(wire.selection).selectionDetails);
    const pagination = wireDetails.pagination == null ? {} : promotionObject(wireDetails.pagination);
    if (!nextPage(s, pagination.nextToken)) { s.selectionIndex++; if (s.selectionIndex === s.selections.length) s.stage = "VERIFY"; }
  } else return invalid();
  return { state: s, rows };
}
