import { adsRegionHosts, type AdsRegion } from "./oauth-contract";
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

const spCampaignMediaType = "application/vnd.spCampaign.v3+json";
const spAdGroupMediaType = "application/vnd.spAdGroup.v3+json";
const spKeywordMediaType = "application/vnd.spKeyword.v3+json";
const spTargetingClauseMediaType = "application/vnd.spTargetingClause.v3+json";
const spNegativeKeywordMediaType = "application/vnd.spNegativeKeyword.v3+json";
const spNegativeTargetingClauseMediaType = "application/vnd.spNegativeTargetingClause.v3+json";
const spCampaignNegativeKeywordMediaType = "application/vnd.spCampaignNegativeKeyword.v3+json";
const spCampaignNegativeTargetingClauseMediaType = "application/vnd.spCampaignNegativeTargetingClause.v3+json";
const spCampaignStates = new Set(["ARCHIVED", "ENABLED", "ENABLING", "OTHER", "PAUSED", "PROPOSED", "USER_DELETED"]);
const spMatchTypes = new Set(["BROAD", "EXACT", "OTHER", "PHRASE"]);
const spNegativeMatchTypes = new Set(["NEGATIVE_BROAD", "NEGATIVE_EXACT", "NEGATIVE_PHRASE", "OTHER"]);
const spExpressionTypes = new Set(["AUTO", "MANUAL", "OTHER"]);
const spTargetPredicateTypes = new Set(["ASIN_ACCESSORY_RELATED", "ASIN_AGE_RANGE_SAME_AS", "ASIN_BRAND_SAME_AS", "ASIN_CATEGORY_SAME_AS", "ASIN_EXPANDED_FROM", "ASIN_GENRE_SAME_AS", "ASIN_IS_PRIME_SHIPPING_ELIGIBLE", "ASIN_PRICE_BETWEEN", "ASIN_PRICE_GREATER_THAN", "ASIN_PRICE_LESS_THAN", "ASIN_REVIEW_RATING_BETWEEN", "ASIN_REVIEW_RATING_GREATER_THAN", "ASIN_REVIEW_RATING_LESS_THAN", "ASIN_SAME_AS", "ASIN_SUBSTITUTE_RELATED", "KEYWORD_GROUP_SAME_AS", "OTHER", "QUERY_BROAD_REL_MATCHES", "QUERY_HIGH_REL_MATCHES"]);
const spNegativePredicateTypes = new Set(["ASIN_BRAND_SAME_AS", "ASIN_SAME_AS", "OTHER"]);
function validExpressions(value: unknown, types: Set<string>) {
  return Array.isArray(value) && value.length <= 1000 && value.every(item => item && typeof item === "object" && !Array.isArray(item)
    && (item.type === undefined || (typeof item.type === "string" && types.has(item.type)))
    && (item.value === undefined || typeof item.value === "string"));
}

export interface SponsoredProductsCampaignTransportInput {
  profileId: string;
  region: AdsRegion;
  accessToken: string;
  clientId: string;
  cursor: string | null;
}

export function createSponsoredProductsCampaignReader(fetcher: typeof fetch = fetch) {
  return {
    async readPage(input: SponsoredProductsCampaignTransportInput): Promise<AdsSyncPage> {
      const body = await postSponsoredProductsList(fetcher, input, "CAMPAIGN", "/sp/campaigns/list", spCampaignMediaType, { includeExtendedDataFields: true, stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] } });
      return parseSponsoredProductsPage(body, input.cursor, "campaigns", value => {
        const campaign = asRecord(value, "CAMPAIGN");
        const budget = campaign.budget;
        if (typeof campaign.campaignId !== "string" || !isAmazonAdsId(campaign.campaignId)
          || typeof campaign.name !== "string" || typeof campaign.startDate !== "string" || !isDateOnly(campaign.startDate)
          || typeof campaign.state !== "string" || !spCampaignStates.has(campaign.state)
          || (campaign.targetingType !== "AUTO" && campaign.targetingType !== "MANUAL")
          || !budget || typeof budget !== "object" || Array.isArray(budget)
          || typeof (budget as Record<string, unknown>).budget !== "number" || !Number.isFinite((budget as Record<string, unknown>).budget)
          || typeof (budget as Record<string, unknown>).budgetType !== "string") throw new AdsSyncError("ADS_CAMPAIGN_RESPONSE_INVALID");
        const lastUpdateDateTime = getLastUpdateDateTime(campaign, "CAMPAIGN");
        return {
          entityType: "SP:campaign", externalId: campaign.campaignId, state: campaign.state, payload: campaign,
          ...(lastUpdateDateTime ? { sourceUpdatedAt: lastUpdateDateTime } : {}),
        };
      });
    },
  };
}

export function createSponsoredProductsAdGroupReader(fetcher: typeof fetch = fetch) {
  return {
    async readPage(input: SponsoredProductsCampaignTransportInput): Promise<AdsSyncPage> {
      const body = await postSponsoredProductsList(fetcher, input, "AD_GROUP", "/sp/adGroups/list", spAdGroupMediaType, { includeExtendedDataFields: true, stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] } });
      return parseSponsoredProductsPage(body, input.cursor, "adGroups", value => {
        const adGroup = asRecord(value, "AD_GROUP");
        if (typeof adGroup.adGroupId !== "string" || !isAmazonAdsId(adGroup.adGroupId)
          || typeof adGroup.campaignId !== "string" || !isAmazonAdsId(adGroup.campaignId)
          || typeof adGroup.name !== "string" || typeof adGroup.defaultBid !== "number" || !Number.isFinite(adGroup.defaultBid)
          || typeof adGroup.state !== "string" || !spCampaignStates.has(adGroup.state)) throw new AdsSyncError("ADS_AD_GROUP_RESPONSE_INVALID");
        const lastUpdateDateTime = getLastUpdateDateTime(adGroup, "AD_GROUP");
        return {
          entityType: "SP:ad-group", externalId: adGroup.adGroupId, parentExternalId: adGroup.campaignId,
          state: adGroup.state, payload: adGroup, ...(lastUpdateDateTime ? { sourceUpdatedAt: lastUpdateDateTime } : {}),
        };
      });
    },
  };
}

export function createSponsoredProductsKeywordReader(fetcher: typeof fetch = fetch) {
  return createSponsoredProductsChildReader(fetcher, {
    resource: "KEYWORD", path: "/sp/keywords/list", mediaType: spKeywordMediaType, collectionKey: "keywords", idKey: "keywordId",
    errorCode: "ADS_KEYWORD_RESPONSE_INVALID", entityType: "SP:keyword",
    parse(row) {
      if (!hasAdsId(row.adGroupId) || !hasAdsId(row.campaignId) || typeof row.keywordText !== "string" || !row.keywordText
        || typeof row.matchType !== "string" || !spMatchTypes.has(row.matchType) || !hasAdsState(row.state)
        || (row.bid !== undefined && row.bid !== null && (typeof row.bid !== "number" || !Number.isFinite(row.bid)))) throw new AdsSyncError("ADS_KEYWORD_RESPONSE_INVALID");
      return { parentExternalId: row.adGroupId, state: row.state };
    },
  });
}

/** Official SP v3 ProductAd: seller SKU and vendor ASIN are optional, not interchangeable. */
export function createSponsoredProductsProductAdReader(fetcher: typeof fetch = fetch) {
  return createSponsoredProductsChildReader(fetcher, {
    resource: "PRODUCT_AD", path: "/sp/productAds/list", mediaType: "application/vnd.spProductAd.v3+json", collectionKey: "productAds", idKey: "adId",
    errorCode: "ADS_PRODUCT_AD_RESPONSE_INVALID", entityType: "SP:product-ad",
    parse(row) {
      if (!hasAdsId(row.adGroupId) || !hasAdsId(row.campaignId) || !hasAdsState(row.state)
        || ["asin", "sku", "customText", "globalAdId"].some(key => row[key] !== undefined && typeof row[key] !== "string")) throw new AdsSyncError("ADS_PRODUCT_AD_RESPONSE_INVALID");
      return { parentExternalId: row.adGroupId, state: row.state };
    },
  });
}

export function createSponsoredProductsTargetReader(fetcher: typeof fetch = fetch) {
  return createSponsoredProductsChildReader(fetcher, {
    resource: "TARGET", path: "/sp/targets/list", mediaType: spTargetingClauseMediaType, collectionKey: "targetingClauses", idKey: "targetId",
    errorCode: "ADS_TARGET_RESPONSE_INVALID", entityType: "SP:target",
    parse(row) {
      if (!hasAdsId(row.adGroupId) || !hasAdsId(row.campaignId) || !validExpressions(row.expression, spTargetPredicateTypes) || !validExpressions(row.resolvedExpression, spTargetPredicateTypes)
        || typeof row.expressionType !== "string" || !spExpressionTypes.has(row.expressionType) || !hasAdsState(row.state)
        || (row.bid !== undefined && row.bid !== null && (typeof row.bid !== "number" || !Number.isFinite(row.bid)))) throw new AdsSyncError("ADS_TARGET_RESPONSE_INVALID");
      return { parentExternalId: row.adGroupId, state: row.state };
    },
  });
}

export function createSponsoredProductsNegativeKeywordReader(fetcher: typeof fetch = fetch) {
  return createSponsoredProductsChildReader(fetcher, {
    resource: "NEGATIVE_KEYWORD", path: "/sp/negativeKeywords/list", mediaType: spNegativeKeywordMediaType, collectionKey: "negativeKeywords", idKey: "keywordId",
    errorCode: "ADS_NEGATIVE_KEYWORD_RESPONSE_INVALID", entityType: "SP:negative-keyword",
    parse(row) {
      if (!hasAdsId(row.adGroupId) || !hasAdsId(row.campaignId) || typeof row.keywordText !== "string" || !row.keywordText
        || typeof row.matchType !== "string" || !spNegativeMatchTypes.has(row.matchType) || !hasAdsState(row.state)) throw new AdsSyncError("ADS_NEGATIVE_KEYWORD_RESPONSE_INVALID");
      return { parentExternalId: row.adGroupId, state: row.state };
    },
  });
}

export function createSponsoredProductsNegativeTargetReader(fetcher: typeof fetch = fetch) {
  return createSponsoredProductsChildReader(fetcher, {
    resource: "NEGATIVE_TARGET", path: "/sp/negativeTargets/list", mediaType: spNegativeTargetingClauseMediaType, collectionKey: "negativeTargetingClauses", idKey: "targetId",
    errorCode: "ADS_NEGATIVE_TARGET_RESPONSE_INVALID", entityType: "SP:negative-target",
    parse(row) {
      if (!hasAdsId(row.adGroupId) || !hasAdsId(row.campaignId) || !validExpressions(row.expression, spNegativePredicateTypes) || !validExpressions(row.resolvedExpression, spNegativePredicateTypes) || !hasAdsState(row.state)) {
        throw new AdsSyncError("ADS_NEGATIVE_TARGET_RESPONSE_INVALID");
      }
      return { parentExternalId: row.adGroupId, state: row.state };
    },
  });
}

export function createSponsoredProductsCampaignNegativeKeywordReader(fetcher: typeof fetch = fetch) {
  return createSponsoredProductsChildReader(fetcher, {
    resource: "CAMPAIGN_NEGATIVE_KEYWORD", path: "/sp/campaignNegativeKeywords/list", mediaType: spCampaignNegativeKeywordMediaType, collectionKey: "campaignNegativeKeywords", idKey: "keywordId",
    errorCode: "ADS_CAMPAIGN_NEGATIVE_KEYWORD_RESPONSE_INVALID", entityType: "SP:campaign-negative-keyword",
    parse(row) {
      if (!hasAdsId(row.campaignId) || typeof row.keywordText !== "string" || !row.keywordText
        || typeof row.matchType !== "string" || !spNegativeMatchTypes.has(row.matchType) || !hasAdsState(row.state)) throw new AdsSyncError("ADS_CAMPAIGN_NEGATIVE_KEYWORD_RESPONSE_INVALID");
      return { parentExternalId: row.campaignId, state: row.state };
    },
  });
}

export function createSponsoredProductsCampaignNegativeTargetReader(fetcher: typeof fetch = fetch) {
  return createSponsoredProductsChildReader(fetcher, {
    resource: "CAMPAIGN_NEGATIVE_TARGET", path: "/sp/campaignNegativeTargets/list", mediaType: spCampaignNegativeTargetingClauseMediaType, collectionKey: "campaignNegativeTargetingClauses", idKey: "targetId",
    errorCode: "ADS_CAMPAIGN_NEGATIVE_TARGET_RESPONSE_INVALID", entityType: "SP:campaign-negative-target",
    parse(row) {
      if (!hasAdsId(row.campaignId) || !validExpressions(row.expression, spNegativePredicateTypes) || !validExpressions(row.resolvedExpression, spNegativePredicateTypes) || !hasAdsState(row.state)) {
        throw new AdsSyncError("ADS_CAMPAIGN_NEGATIVE_TARGET_RESPONSE_INVALID");
      }
      return { parentExternalId: row.campaignId, state: row.state };
    },
  });
}

function createSponsoredProductsChildReader(
  fetcher: typeof fetch,
  contract: { resource: "KEYWORD" | "TARGET" | "NEGATIVE_KEYWORD" | "NEGATIVE_TARGET" | "CAMPAIGN_NEGATIVE_KEYWORD" | "CAMPAIGN_NEGATIVE_TARGET" | "PRODUCT_AD"; path: string; mediaType: string; collectionKey: string; idKey: "keywordId" | "targetId" | "adId"; errorCode: string; entityType: string; parse: (row: Record<string, unknown>) => { parentExternalId: string; state: string } },
) {
  return {
    async readPage(input: SponsoredProductsCampaignTransportInput): Promise<AdsSyncPage> {
      const body = await postSponsoredProductsList(fetcher, input, contract.resource, contract.path, contract.mediaType, { includeExtendedDataFields: true, stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] } });
      return parseSponsoredProductsPage(body, input.cursor, contract.collectionKey, value => {
        const row = asRecordWithError(value, contract.errorCode);
        if (!hasAdsId(row[contract.idKey])) throw new AdsSyncError(contract.errorCode);
        const parent = contract.parse(row);
        const lastUpdateDateTime = getLastUpdateDateTimeWithError(row, contract.errorCode);
        return { entityType: contract.entityType, externalId: row[contract.idKey] as string, ...parent, payload: row,
          ...(lastUpdateDateTime ? { sourceUpdatedAt: lastUpdateDateTime } : {}) };
      }, contract.errorCode);
    },
  };
}

async function postSponsoredProductsList(
  fetcher: typeof fetch,
  input: SponsoredProductsCampaignTransportInput,
  resource: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "TARGET" | "NEGATIVE_KEYWORD" | "NEGATIVE_TARGET" | "CAMPAIGN_NEGATIVE_KEYWORD" | "CAMPAIGN_NEGATIVE_TARGET" | "PRODUCT_AD",
  path: string,
  mediaType: string,
  requestBody: Record<string, unknown>,
) {
  if (!isAdsRegion(input.region) || !/^\d{1,40}$/.test(input.profileId) || !input.clientId || !input.accessToken || (input.cursor !== null && (!input.cursor || input.cursor.length > 16384))) {
    throw new AdsSyncError(`ADS_${resource}_INPUT_INVALID`);
  }
  let response: Response;
  try {
    response = await fetcher(`${adsRegionHosts[input.region]}${path}`, {
      method: "POST",
      headers: {
        Accept: mediaType,
        "Content-Type": mediaType,
        "Amazon-Advertising-API-ClientId": input.clientId,
        "Amazon-Advertising-API-Scope": input.profileId,
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({ ...requestBody, ...(input.cursor ? { nextToken: input.cursor } : {}) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AdsSyncError(`ADS_${resource}_NETWORK_FAILED`, true);
  }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const retryAfterMs = response.status === 429 ? parseRetryAfter(response.headers.get("retry-after")) : 0;
    throw new AdsSyncError(`ADS_${resource}_HTTP_${response.status}`, retryable, retryAfterMs);
  }
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid payload");
    return payload as Record<string, unknown>;
  } catch {
    throw new AdsSyncError(`ADS_${resource}_RESPONSE_INVALID`);
  }
}

function parseSponsoredProductsPage(body: Record<string, unknown>, cursor: string | null, collectionKey: string, parseEntity: (value: unknown) => AdsSyncedEntity, errorCode?: string): AdsSyncPage {
  const collection = body[collectionKey];
  if (!Array.isArray(collection) || collection.length > 1000 || (body.nextToken !== undefined && body.nextToken !== null && (typeof body.nextToken !== "string" || !body.nextToken || body.nextToken.length > 16384 || body.nextToken === cursor))) {
    throw new AdsSyncError(errorCode ?? (collectionKey === "campaigns" ? "ADS_CAMPAIGN_RESPONSE_INVALID" : "ADS_AD_GROUP_RESPONSE_INVALID"));
  }
  try { return { entities: collection.map(parseEntity), nextCursor: typeof body.nextToken === "string" ? body.nextToken : null, complete: true }; }
  catch (error) { if (error instanceof AdsSyncError) throw error; throw new AdsSyncError(errorCode ?? "ADS_RESPONSE_INVALID"); }
}

function asRecordWithError(value: unknown, errorCode: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdsSyncError(errorCode);
  return value as Record<string, unknown>;
}
function getLastUpdateDateTimeWithError(entity: Record<string, unknown>, errorCode: string) {
  const extendedData = entity.extendedData;
  if (extendedData !== undefined && (!extendedData || typeof extendedData !== "object" || Array.isArray(extendedData))) throw new AdsSyncError(errorCode);
  const updatedAt = (extendedData as Record<string, unknown> | undefined)?.lastUpdateDateTime;
  if (updatedAt !== undefined && (typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)))) throw new AdsSyncError(errorCode);
  return typeof updatedAt === "string" ? updatedAt : null;
}
function hasAdsId(value: unknown): value is string { return typeof value === "string" && isAmazonAdsId(value); }
function hasAdsState(value: unknown): value is string { return typeof value === "string" && spCampaignStates.has(value); }

function asRecord(value: unknown, resource: "CAMPAIGN" | "AD_GROUP") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdsSyncError(`ADS_${resource}_RESPONSE_INVALID`);
  return value as Record<string, unknown>;
}

function getLastUpdateDateTime(entity: Record<string, unknown>, resource: "CAMPAIGN" | "AD_GROUP") {
  const extendedData = entity.extendedData;
  if (extendedData !== undefined && (!extendedData || typeof extendedData !== "object" || Array.isArray(extendedData))) throw new AdsSyncError(`ADS_${resource}_RESPONSE_INVALID`);
  const lastUpdateDateTime = (extendedData as Record<string, unknown> | undefined)?.lastUpdateDateTime;
  if (lastUpdateDateTime !== undefined && (typeof lastUpdateDateTime !== "string" || !Number.isFinite(Date.parse(lastUpdateDateTime)))) throw new AdsSyncError(`ADS_${resource}_RESPONSE_INVALID`);
  return typeof lastUpdateDateTime === "string" ? lastUpdateDateTime : null;
}

function isAmazonAdsId(value: string) { return /^\d{1,40}$/.test(value); }

function parseRetryAfter(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.min(3600000, Math.max(0, delay)) : 0;
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// Live entity/report contracts are not yet verified. Never return demo rows or claim success.
export const pendingAdsReadAdapter: AdsReadAdapter = {
  assertImplemented() { throw new AdsSyncError("ADS_READ_ADAPTER_NOT_IMPLEMENTED"); },
  async readPage() { throw new AdsSyncError("ADS_READ_ADAPTER_NOT_IMPLEMENTED"); },
};
/** One HTTP page per dispatch, including each of the four distinct negative collections. */
export function createSponsoredProductsReadAdapter(fetcher: typeof fetch = fetch): AdsReadAdapter {
  const readers = { campaigns: createSponsoredProductsCampaignReader(fetcher), "ad-groups": createSponsoredProductsAdGroupReader(fetcher), keywords: createSponsoredProductsKeywordReader(fetcher), targets: createSponsoredProductsTargetReader(fetcher), "product-ads": createSponsoredProductsProductAdReader(fetcher) };
  const negatives = [createSponsoredProductsNegativeKeywordReader(fetcher), createSponsoredProductsNegativeTargetReader(fetcher), createSponsoredProductsCampaignNegativeKeywordReader(fetcher), createSponsoredProductsCampaignNegativeTargetReader(fetcher)];
  return {
    assertImplemented() { /* SP structure only; reports deliberately unsupported. */ },
    async readPage(input) {
      if (input.stage === "reports") throw new AdsSyncError("ADS_REPORT_ADAPTER_NOT_IMPLEMENTED");
      if (input.stage !== "negatives") {
        const reader = readers[input.stage];
        if (!reader) throw new AdsSyncError("ADS_STAGE_NOT_IMPLEMENTED");
        return reader.readPage(input);
      }
      let index = 0, cursor: string | null = null;
      if (input.cursor !== null) {
        try {
          const value = JSON.parse(input.cursor);
          if (!value || value.v !== 1 || !Number.isInteger(value.index) || value.index < 0 || value.index >= negatives.length || (value.token !== null && (typeof value.token !== "string" || !value.token || value.token.length > 16384))) throw new Error();
          index = value.index; cursor = value.token;
        } catch { throw new AdsSyncError("ADS_NEGATIVE_CHECKPOINT_INVALID"); }
      }
      const page = await negatives[index].readPage({ ...input, cursor });
      const nextCursor = page.nextCursor ? JSON.stringify({ v: 1, index, token: page.nextCursor }) : index + 1 < negatives.length ? JSON.stringify({ v: 1, index: index + 1, token: null }) : null;
      if (nextCursor && nextCursor.length > 16384) throw new AdsSyncError("ADS_NEGATIVE_CHECKPOINT_INVALID");
      return { ...page, nextCursor };
    },
  };
}
export const amazonAdsReadAdapter: AdsReadAdapter = createSponsoredProductsReadAdapter();
export const verifiedAdsReadStages: ReadonlySet<AdsSyncStage> = new Set(["campaigns", "ad-groups", "keywords", "targets", "negatives", "product-ads"]);
export function adsReadAdapterReady(requiredStages: readonly AdsSyncStage[] = ["campaigns", "ad-groups", "keywords", "targets", "negatives", "product-ads"]) {
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
