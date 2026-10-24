/** Sponsored Products v3 contract. This release deliberately has NO HTTP transport. */
export type SponsoredProductsBidUpdate = { entity: "keyword" | "target"; entityId: string; bid: number };
export class AmazonAdsClientError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}
export function sponsoredProductsBidRequest(input: {
  region: "NA" | "EU" | "FE"; profileId: string; clientId: string; accessToken: string; updates: SponsoredProductsBidUpdate[];
}) {
  if (!/^\d+$/.test(input.profileId) || !input.clientId || !input.accessToken || !input.updates.length || input.updates.length > 100) throw new AmazonAdsClientError("INVALID_REQUEST", "Invalid Ads identity or batch size.");
  const entity = input.updates[0].entity;
  if (!["keyword", "target"].includes(entity) || input.updates.some((row) => row.entity !== entity || !/^\d+$/.test(row.entityId) || !Number.isFinite(row.bid) || row.bid < 0.02 || row.bid > 100)
    || new Set(input.updates.map((row) => row.entityId)).size !== input.updates.length) throw new AmazonAdsClientError("INVALID_REQUEST", "Requires one homogeneous batch of unique official keyword/target IDs and bids in [0.02, 100].");
  const hosts = { NA: "https://advertising-api.amazon.com", EU: "https://advertising-api-eu.amazon.com", FE: "https://advertising-api-fe.amazon.com" };
  if (!hosts[input.region]) throw new AmazonAdsClientError("INVALID_REQUEST", "Unknown Ads region.");
  const keywords = entity === "keyword";
  const media = keywords ? "application/vnd.spKeyword.v3+json" : "application/vnd.spTargetingClause.v3+json";
  return { url: `${hosts[input.region]}${keywords ? "/sp/keywords" : "/sp/targets"}`, method: "PUT" as const,
    headers: { Authorization: `Bearer ${input.accessToken}`, "Amazon-Advertising-API-ClientId": input.clientId, "Amazon-Advertising-API-Scope": input.profileId, "Content-Type": media, Accept: media },
    body: { [keywords ? "keywords" : "targetingClauses"]: input.updates.map((row) => ({ [keywords ? "keywordId" : "targetId"]: row.entityId, bid: row.bid })) } };
}
export function mapAmazonAdsError(status: number): { code: string; retryable: boolean; message: string } {
  const code = status === 401 ? "ADS_UNAUTHORIZED" : status === 403 ? "ADS_FORBIDDEN" : status === 429 ? "ADS_THROTTLED" : status >= 500 ? "ADS_UNAVAILABLE" : "ADS_REQUEST_REJECTED";
  // An HTTP status alone never proves that no update was applied. No automatic retries.
  return { code, retryable: false, message: `Amazon Ads HTTP ${status}; reconcile per-entity results before retrying.` };
}
export function assertAmazonAdsTransportImplemented(): never {
  throw new AmazonAdsClientError("NOT_IMPLEMENTED", "真实 Amazon Ads HTTP transport 尚未实现；整批未发送，未发生部分写入。开关不能绕过此闸门。");
}

export type AmazonAdsBidBatch = Parameters<typeof sponsoredProductsBidRequest>[0];
export type AmazonAdsBidResult = { entityId: string; index: number; status: "APPLIED" | "FAILED"; code: string | null };
export interface AmazonAdsBidClient {
  updateBids(input: AmazonAdsBidBatch): Promise<AmazonAdsBidResult[]>;
}
export const unimplementedAmazonAdsBidClient: AmazonAdsBidClient = {
  async updateBids(input) {
    sponsoredProductsBidRequest(input); // validate the ENTIRE batch before any future transport
    return assertAmazonAdsTransportImplemented();
  },
};
/** Strict v3 207 decoder. Missing/duplicate indexes mean uncertain outcomes, never blanket success. */
export function parseSponsoredProductsBidResponse(payload: unknown, updates: SponsoredProductsBidUpdate[]): AmazonAdsBidResult[] {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const body = object(object(payload)[updates[0]?.entity === "keyword" ? "keywords" : "targetingClauses"]);
  if (!Array.isArray(body.success) || !Array.isArray(body.error)) throw new AmazonAdsClientError("OUTCOME_UNKNOWN", "Ads response is incomplete; reconcile before retrying.");
  const results = new Map<number, AmazonAdsBidResult>();
  for (const [rows, status] of [[body.success, "APPLIED"], [body.error, "FAILED"]] as const) {
    for (const raw of rows) {
      const row = object(raw); const index = row.index;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= updates.length || results.has(index)) throw new AmazonAdsClientError("OUTCOME_UNKNOWN", "Invalid or duplicate Ads result index.");
      const id = row[updates[index].entity === "keyword" ? "keywordId" : "targetId"];
      if (status === "APPLIED" && String(id) !== updates[index].entityId) throw new AmazonAdsClientError("OUTCOME_UNKNOWN", "Ads result entity mismatch.");
      // Do not expose upstream free text or credentials in audit/API errors.
      results.set(index, { entityId: updates[index].entityId, index, status, code: status === "FAILED" ? "ADS_ENTITY_REJECTED" : null });
    }
  }
  if (results.size !== updates.length) throw new AmazonAdsClientError("OUTCOME_UNKNOWN", "Missing Ads entity outcomes; reconcile before retrying.");
  return [...results.values()].sort((left, right) => left.index - right.index);
}
