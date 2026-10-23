export const amazonReadDomains = ["ads", "orders", "inventory", "catalog", "finance", "fulfillment"] as const;

export type AmazonReadDomain = (typeof amazonReadDomains)[number];
export type AmazonSyncResource = "readiness" | AmazonReadDomain;

export type AmazonMarketplaceParticipation = {
  marketplaceId: string;
  countryCode: string;
  name: string;
  domainName: string;
};

export type OperationsConnection = {
  id: string | null;
  provider: "amazon_sp_api";
  status: "NOT_CONFIGURED" | "CONFIGURED" | "DISABLED" | "ERROR";
  enabledDomains: AmazonReadDomain[];
  marketplaceParticipations: AmazonMarketplaceParticipation[];
  statusMessage: string;
  lastValidatedAt: string | null;
  lastSyncAt: string | null;
  runtimeConfiguration: {
    configured: boolean;
    missingEnvironmentVariables: string[];
    region: string;
  };
};

export type OperationsSyncRun = {
  id: string;
  resource: AmazonSyncResource;
  idempotencyKey: string | null;
  status: "BLOCKED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  summary: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type OperationsInventorySnapshotSummary = {
  status: "NOT_SYNCED" | "FRESH" | "STALE";
  syncRunId: string | null;
  capturedAt: string | null;
  snapshotCount: number;
  fulfillableQuantity: number;
  inboundQuantity: number;
  reservedQuantity: number;
  unfulfillableQuantity: number;
};

export type DomainFreshnessStatus = "NOT_SYNCED" | "FRESH" | "STALE" | "BLOCKED" | "FAILED" | "SYNCING" | "DISABLED";

export type DomainFreshnessSummary = {
  resource: AmazonReadDomain;
  status: DomainFreshnessStatus;
  source: string | null;
  syncRunId: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: OperationsSyncRun["status"] | null;
  lastAttemptError: string | null;
  reason: string | null;
  recommendedAction: string | null;
  nextScheduledAt?: string | null;
};

export type OperationsDailyMetric = {
  date: string;
  sku: string;
  asin: string;
  currency: string;
  sales: number | null;
  adSpend: number | null;
  tacos: number | null;
  fieldNotes: {
    sales: string | null;
    adSpend: string | null;
    tacos: string | null;
  };
};

export type OperationsReadiness = {
  scope: { workspaceId: string; accountId: string; marketplace: string };
  connection: OperationsConnection;
  runs: OperationsSyncRun[];
  inventory: OperationsInventorySnapshotSummary;
  domains: Record<AmazonReadDomain, DomainFreshnessSummary>;
  generatedAt: string;
};

export function isAmazonSyncResource(value: unknown): value is AmazonSyncResource {
  return value === "readiness" || (typeof value === "string" && (amazonReadDomains as readonly string[]).includes(value));
}
