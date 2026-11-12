/** Code capabilities only. This catalog never grants access or enables a sync task. */
export const adsCapabilityDomains = [
  "profiles", "campaigns", "ad-groups", "product-ads", "keywords", "targets",
  "negative-keywords", "negative-targets", "campaign-negative-keywords", "campaign-negative-targets",
  "portfolios", "budget-bidding", "campaign-performance", "advertised-product-performance",
  "search-term-performance", "placement-performance", "targeting-performance", "creative-brand",
] as const;

export type AdsCapabilityDomain = typeof adsCapabilityDomains[number];
export type AdsCapabilityProduct = "SP" | "SB" | "SD";
/** Acquisition status is separate from read/query and live account acceptance. */
export type AdsCapabilityAcquisition = "NONE" | "ISOLATED_FIXTURE_ONLY" | "FORMAL_LIVE_ADAPTER";
export type AdsCapability = Readonly<{
  product: AdsCapabilityProduct;
  domain: AdsCapabilityDomain;
  priority: "P0" | "P1";
  read: "AUTHORIZATION_FLOW" | "STRUCTURE_WORKER" | "NOT_IMPLEMENTED";
  write: "NOT_IMPLEMENTED";
  contract: "DOCUMENTED_STRUCTURE" | "PROFILE_CONTRACT" | "UNVERIFIED";
  apiVersion: string | null;
  endpoints: readonly string[];
  entityType: string | null;
  storage: "PROFILE_RECORD" | "CURRENT_ENTITY_SNAPSHOT" | "REPORT_VERSION_FOUNDATION" | "NOT_IMPLEMENTED";
  query: "PROFILE_MANAGEMENT" | "ENTITY_QUERY" | "PUBLISHED_REPORT_QUERY_ONLY" | "NOT_IMPLEMENTED";
  ui: "ACCOUNT_MANAGEMENT" | "SYNCED_DATA" | "NOT_IMPLEMENTED";
  mcpTool: "amazon.ads.entities.list" | "amazon.ads.reports.list" | null;
  acquisition: AdsCapabilityAcquisition;
  // Neither source code nor account connection proves that this domain was accepted live.
  liveAcceptance: "NOT_VERIFIED";
  accountPermission: "REQUIRES_PROFILE_CHECK";
  historyLimitDays: null;
  evidence: readonly string[];
  limitations: readonly string[];
}>;

const reports = new Set<AdsCapabilityDomain>([
  "campaign-performance", "advertised-product-performance", "search-term-performance",
  "placement-performance", "targeting-performance",
]);
const later = new Set<AdsCapabilityDomain>(["portfolios", "budget-bidding", "creative-brand"]);
const structure = {
  campaigns: ["/sp/campaigns/list", "SP:campaign"],
  "ad-groups": ["/sp/adGroups/list", "SP:ad-group"],
  "product-ads": ["/sp/productAds/list", "SP:product-ad"],
  keywords: ["/sp/keywords/list", "SP:keyword"],
  targets: ["/sp/targets/list", "SP:target"],
  "negative-keywords": ["/sp/negativeKeywords/list", "SP:negative-keyword"],
  "negative-targets": ["/sp/negativeTargets/list", "SP:negative-target"],
  "campaign-negative-keywords": ["/sp/campaignNegativeKeywords/list", "SP:campaign-negative-keyword"],
  "campaign-negative-targets": ["/sp/campaignNegativeTargets/list", "SP:campaign-negative-target"],
} as const;

function capability(product: AdsCapabilityProduct, domain: AdsCapabilityDomain): AdsCapability {
  const base: AdsCapability = {
    product, domain, priority: later.has(domain) ? "P1" : "P0",
    read: "NOT_IMPLEMENTED", write: "NOT_IMPLEMENTED", contract: "UNVERIFIED",
    apiVersion: null, endpoints: [], entityType: null, storage: "NOT_IMPLEMENTED",
    query: "NOT_IMPLEMENTED", ui: "NOT_IMPLEMENTED", mcpTool: null,
    acquisition: "NONE",
    liveAcceptance: "NOT_VERIFIED", accountPermission: "REQUIRES_PROFILE_CHECK", historyLimitDays: null,
    evidence: [], limitations: ["No verified domain contract or live account acceptance."],
  };
  if (domain === "profiles") return {
    ...base, read: "AUTHORIZATION_FLOW", contract: "PROFILE_CONTRACT", apiVersion: "Profiles v2",
    endpoints: ["/v2/profiles"], storage: "PROFILE_RECORD", query: "PROFILE_MANAGEMENT", ui: "ACCOUNT_MANAGEMENT",
    evidence: ["src/lib/amazon-ads/oauth-contract.ts", "src/lib/amazon-ads/authorization.ts"],
    limitations: ["Shared account discovery does not prove SP, SB or SD domain permissions."],
  };
  // SP readers are not evidence of SB/SD support. Unknown is not 'unsupported by Amazon'.
  if (product !== "SP") return base;
  if (domain in structure) {
    const [endpoint, entityType] = structure[domain as keyof typeof structure];
    return {
      ...base, read: "STRUCTURE_WORKER", contract: "DOCUMENTED_STRUCTURE", apiVersion: "Sponsored Products v3",
      endpoints: [endpoint], entityType, storage: "CURRENT_ENTITY_SNAPSHOT", query: "ENTITY_QUERY",
      ui: "SYNCED_DATA", mcpTool: "amazon.ads.entities.list",
      evidence: ["src/lib/amazon-ads/sync-adapter.ts", "src/lib/amazon-ads/sync-processor.ts", "docs/amazon-ads-api-integration.md"],
      limitations: ["Current snapshot only; missing rows are not deletions.", "Whole-domain atomic publication is not implemented. Optional persisted observations cover successful collected snapshot differences only; they are not complete Amazon change history."],
    };
  }
  if (reports.has(domain)) return {
    ...base, storage: "REPORT_VERSION_FOUNDATION", query: "PUBLISHED_REPORT_QUERY_ONLY",
    acquisition: domain === "campaign-performance" ? "ISOLATED_FIXTURE_ONLY" : "NONE",
    ui: "SYNCED_DATA", mcpTool: "amazon.ads.reports.list",
    evidence: domain === "campaign-performance"
      ? ["src/lib/amazon-ads/campaign-report-contract.ts", "src/lib/amazon-ads/report-acquisition.ts", "src/lib/amazon-ads/report-publication.ts"]
      : ["src/lib/amazon-ads/report-query.ts", "src/lib/amazon-ads/report-publication.ts"],
    limitations: domain === "campaign-performance"
      ? ["Acquisition is isolated-fixture-only; no formal live adapter or worker is enabled.", "Live Profile permission and account acceptance are not verified."]
      : ["Generic published-fact query is not a domain-specific report contract.", "Report acquisition is not implemented for this report domain."],
  };
  return base;
}

export function listAdsCapabilities(product?: AdsCapabilityProduct): readonly AdsCapability[] {
  const products: readonly AdsCapabilityProduct[] = product ? [product] : ["SP", "SB", "SD"];
  return products.flatMap(value => adsCapabilityDomains.map(domain => capability(value, domain)));
}

/** Explicit reasons for hiding execution controls; not a substitute for runtime authorization. */
export function adsCapabilityBlockers(row: AdsCapability): readonly string[] {
  return [
    ...(row.contract === "UNVERIFIED" ? ["DOMAIN_CONTRACT_UNVERIFIED"] : []),
    ...(row.read === "NOT_IMPLEMENTED" ? ["READ_ADAPTER_NOT_IMPLEMENTED"] : []),
    ...(row.acquisition === "ISOLATED_FIXTURE_ONLY" ? ["ISOLATED_FIXTURE_ONLY"] : []),
    "LIVE_ACCEPTANCE_NOT_VERIFIED", "PROFILE_PERMISSION_REQUIRES_CHECK", "WRITE_NOT_IMPLEMENTED",
  ];
}
