import { SyncInputError } from "./policy";
import { parseDomainReport, type NormalizedDomainReportRow } from "./domain-reports";

export type SettlementPolicy = { collectionMarketplaceIds: string[]; archiveOnlyMarketplaceIds: string[] };
export type SettlementBinding = { sourceId: string; revision: number; sellerAccountId: string; marketplaceId: string };
export function parseSettlementPolicy(value: unknown): SettlementPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("结算须明确批准卖家级报告的采集站点。");
  const row = value as Record<string, unknown>, ids = row.collectionMarketplaceIds;
  if (Object.keys(row).some(k => !["collectionMarketplaceIds", "archiveOnlyMarketplaceIds"].includes(k)) || !Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => typeof id !== "string" || !/^[A-Z0-9]{8,20}$/.test(id)) || new Set(ids).size !== ids.length) throw new SyncInputError("结算采集站点须为 1–30 个唯一 Marketplace ID。");
  const archiveOnly = row.archiveOnlyMarketplaceIds ?? [];
  if (!Array.isArray(archiveOnly) || archiveOnly.length > 30 || new Set(archiveOnly).size !== archiveOnly.length || archiveOnly.some(id => typeof id !== "string" || !ids.includes(id))) throw new SyncInputError("仅归档站点须包含于明确批准的采集范围。");
  return { collectionMarketplaceIds: [...ids].sort(), archiveOnlyMarketplaceIds: [...archiveOnly].sort() };
}
export function assertSettlementMarketplaces(value: unknown, policy: SettlementPolicy, anchor: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 30 || value.some(id => typeof id !== "string" || !/^[A-Z0-9]{8,20}$/.test(id)) || new Set(value).size !== value.length || !value.includes(anchor)) throw new SyncInputError("结算报告站点身份无效。", 422);
  if (value.some(id => !policy.collectionMarketplaceIds.includes(id))) throw new SyncInputError("SETTLEMENT_COLLECTION_SCOPE：报告包含未批准采集的站点，未下载原件。", 403);
  return [...value].sort();
}
// Exact Amazon marketplace names only. Currency, order IDs and SKUs never imply a site.
const marketplaceNames: Record<string, string> = {
  "amazon.com": "ATVPDKIKX0DER", "amazon.ca": "A2EUQ1WTGCTBG2", "amazon.com.mx": "A1AM78C64UM0Y8", "amazon.com.br": "A2Q3Y263D00KWC",
  "amazon.co.uk": "A1F83G8C2ARO7P", "amazon.de": "A1PA6795UKMFR9", "amazon.fr": "A13V1IB3VIYZZH", "amazon.it": "APJ6JRA9NG5V4", "amazon.es": "A1RKKUPIHCS9HS",
  "amazon.nl": "A1805IZSGTT6HS", "amazon.se": "A2NODRKZP88ZB9", "amazon.pl": "A1C3SOZRARQ6R3", "amazon.com.be": "AMEN7PMS3EDWL", "amazon.ie": "A28R8C7NBKEWEA",
  "amazon.co.jp": "A1VC38T7YXB528", "amazon.com.au": "A39IBJ37TRP1C6", "amazon.sg": "A19VAU5U5O7RUS", "amazon.in": "A21TJRUUN4KGV", "amazon.ae": "A2VIGQ35RCS4UG", "amazon.sa": "A17E79C6D8DWNP", "amazon.com.tr": "A33AVAJ2PDY3EV",
};
export type SettlementAttribution = "ATTRIBUTED" | "MISSING_MARKETPLACE" | "CONFLICTING_MARKETPLACE" | "OUT_OF_SCOPE";
export function attributeSettlementRow(row: NormalizedDomainReportRow, declared: string[], bindings: SettlementBinding[]): { status: SettlementAttribution; binding?: SettlementBinding } {
  const id = row.fields["marketplace-id"]?.trim(), name = row.fields["marketplace-name"]?.trim().toLowerCase();
  const named = name ? marketplaceNames[name] : undefined;
  if ((name && !named) || (id && named && id !== named)) return { status: "CONFLICTING_MARKETPLACE" };
  const marketplaceId = id || named;
  if (!marketplaceId) return { status: "MISSING_MARKETPLACE" };
  const matches = bindings.filter(b => b.marketplaceId === marketplaceId);
  if (!declared.includes(marketplaceId) || !matches.length) return { status: "OUT_OF_SCOPE" };
  if (matches.length !== 1) return { status: "CONFLICTING_MARKETPLACE" };
  return { status: "ATTRIBUTED", binding: matches[0] };
}
export function parseSettlementReport(text: string, declared: string[], bindings: SettlementBinding[], options: { offset?: number; limit?: number } = {}) {
  const parsed = parseDomainReport("settlements", text, options);
  return { ...parsed, rows: parsed.rows.map(row => ({ row, ...attributeSettlementRow(row, declared, bindings) })) };
}
