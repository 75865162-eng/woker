import { SyncInputError, type SyncScope } from "./policy";

export type SellerArchivePolicy = { mode: "seller-archive-only"; version: 1; publication: "quarantined" };
export function parseSellerArchivePolicy(value: unknown): SellerArchivePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("卖家归档策略无效。");
  const p = value as Record<string, unknown>;
  if (p.mode !== "seller-archive-only" || p.version !== 1 || p.publication !== "quarantined" || Object.keys(p).some(k => !["mode", "version", "publication"].includes(k))) throw new SyncInputError("卖家归档策略无效。");
  return { mode: "seller-archive-only", version: 1, publication: "quarantined" };
}
export function sellerArchivePolicy(resource: string, value: unknown): SellerArchivePolicy | undefined {
  if (!["inventory_events", "reimbursements"].includes(resource) || value == null) return undefined;
  return parseSellerArchivePolicy(value);
}
export function assertSellerArchiveTarget(scope: SyncScope, marketplaceId: string) {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE === "1" && url.hostname === "127.0.0.1" && url.pathname === "/amazon_sync_test" && scope.organizationId.startsWith("domain-report-fixture-") && scope.workspaceId === "domain-report-test" && marketplaceId === "ATVPDKIKX0DER") return;
  if ((process.env.AMAZON_DATA_CENTER_ENVIRONMENT ?? "local") !== "local" || process.env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local" || scope.organizationId !== "amazon-live-local" || scope.workspaceId !== "default" || marketplaceId !== "ATVPDKIKX0DER") throw new SyncInputError("卖家持续归档仅限已批准独立本机美国单入口。", 403);
}
