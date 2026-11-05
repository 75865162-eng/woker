import type { AdsRegion } from "./oauth-contract";
import { AdsSyncError, type AdsSyncStage } from "./sync-policy";

export interface AdsSyncedEntity {
  entityType: string; externalId: string; parentExternalId?: string; state?: string;
  payload: Record<string, unknown>; sourceUpdatedAt?: string;
}
export interface AdsSyncPage {
  entities: AdsSyncedEntity[];
  reportFacts?: AdsReportFactInput[];
  nextCursor: string | null;
  /** An adapter must explicitly attest complete/validated page semantics. */
  complete: boolean;
}
export interface AdsReportFactInput {
  reportType: string; adProduct: string; reportDate: string; factKey: string;
  campaignId?: string; adGroupId?: string; targetingId?: string; advertisedAsin?: string;
  searchTerm?: string; placement?: string; impressions: number; clicks: number;
  spend: number; orders: number; sales: number; units: number; attributionWindow?: string;
  apiVersion: string; rawDimensions: Record<string, unknown>;
}
export interface AdsReadAdapter {
  /** Must fail before token exchange if any required domain is unavailable. */
  assertImplemented(): void;
  readPage(input: { stage: AdsSyncStage; cursor: string | null; profileId: string; region: AdsRegion; accessToken: string; clientId: string; dateRange?: { from: string; to: string } }): Promise<AdsSyncPage>;
}
// Live entity/report contracts are not yet verified. Never return demo rows or claim success.
export const pendingAdsReadAdapter: AdsReadAdapter = {
  assertImplemented() { throw new AdsSyncError("ADS_READ_ADAPTER_NOT_IMPLEMENTED"); },
  async readPage() { throw new AdsSyncError("ADS_READ_ADAPTER_NOT_IMPLEMENTED"); },
};
export const amazonAdsReadAdapter: AdsReadAdapter = pendingAdsReadAdapter;
export const verifiedAdsReadStages: ReadonlySet<AdsSyncStage> = new Set();
export function adsReadAdapterReady(requiredStages: readonly AdsSyncStage[] = ["campaigns", "ad-groups", "keywords", "targets", "negatives", "reports"]) {
  return requiredStages.length > 0 && requiredStages.every(stage => verifiedAdsReadStages.has(stage));
}
export function isAdsRegion(value: string): value is AdsRegion { return value === "NA" || value === "EU" || value === "FE"; }
export function validateAdsPage(page: AdsSyncPage, previousCursor: string | null) {
  if (!page.complete || !Array.isArray(page.entities) || page.entities.length > 1000 || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 16384 || page.nextCursor === previousCursor))) throw new AdsSyncError("ADS_PAGE_INVALID");
  const keys = new Set<string>();
  for (const row of page.entities) {
    if (!row || typeof row.entityType !== "string" || !/^(SP|SB|SD):[a-z-]+$/.test(row.entityType) || typeof row.externalId !== "string" || !/^\d{1,40}$/.test(row.externalId) || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload) || (row.sourceUpdatedAt !== undefined && !Number.isFinite(Date.parse(row.sourceUpdatedAt)))) throw new AdsSyncError("ADS_ENTITY_INVALID");
    const key = JSON.stringify([row.entityType, row.externalId]);
    if (keys.has(key)) throw new AdsSyncError("ADS_DUPLICATE_ENTITY");
    keys.add(key);
  }
  if (!Array.isArray(page.reportFacts ?? []) || (page.reportFacts?.length ?? 0) > 5000) throw new AdsSyncError("ADS_REPORT_PAGE_INVALID");
  for (const fact of page.reportFacts ?? []) {
    if (!fact || typeof fact.reportType !== "string" || !fact.reportType || fact.reportType.length > 100 || typeof fact.adProduct !== "string" || !fact.adProduct || !/^\d{4}-\d{2}-\d{2}$/.test(fact.reportDate) || !Number.isFinite(Date.parse(fact.reportDate)) || new Date(`${fact.reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== fact.reportDate || !/^[a-f0-9]{64}$/.test(fact.factKey) || typeof fact.apiVersion !== "string" || !fact.apiVersion || !fact.rawDimensions || typeof fact.rawDimensions !== "object" || Array.isArray(fact.rawDimensions) || [fact.impressions, fact.clicks, fact.orders, fact.units].some(n => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) || [fact.spend, fact.sales].some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0)) throw new AdsSyncError("ADS_REPORT_FACT_INVALID");
  }
  return page;
}
