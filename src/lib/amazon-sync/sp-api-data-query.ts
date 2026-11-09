import { readOrders } from "./orders-query";
import { readFinance } from "./finance-query";
import { readReturns } from "./returns-query";
import { readDomainReports } from "./domain-reports-query";
import { readObservations } from "./observations-query";
import { readBrandAnalytics } from "./brand-analytics-query";
import { spApiDataTables } from "./sp-api-datasets";
import { McpDatasetError } from "./mcp-datasets";
import type { SyncScope } from "./policy";

export const isSpApiDataset = (name: string) => spApiDataTables.some(table => table.name === name);

/** Dispatch only to existing ERP readers. Their RBAC, attribution and version
 * checks remain authoritative; no raw SQL/JSON escape hatch is introduced. */
export async function querySpApiDataset(input: {
  scope: SyncScope; actor: string; tableName: string; resource: string;
  sources: Array<{ id: string; sellerAccountId: string; marketplaceId: string }>;
  filters: Record<string, string>; page: number; pageSize: number;
}) {
  const candidates = input.sources.filter(source => !input.filters.sourceId || input.filters.sourceId === source.id);
  if (!candidates.length) throw new McpDatasetError("DATASET_UNPUBLISHED", "当前数据来源不在授权范围内。", 403);
  if (candidates.length !== 1) throw new McpDatasetError("DATASET_SCOPE_REQUIRED", "该数据域按来源保持报告与版本语义，请用店铺/站点或 sourceId 限定一个来源。");
  if (input.resource === "brand_analytics" && !input.filters.reportKind) throw new McpDatasetError("FILTER_REQUIRED", "品牌查询须指定 reportKind；不能将不同报告类型混作一个数据集。");
  if (input.page > 1000 && ["fulfillment", "listing_details", "catalog_items", "pricing", "buy_box_history", "notifications"].includes(input.resource)) throw new McpDatasetError("PAGE_OUT_OF_RANGE", "观察查询页码最多 1000。");
  if (input.page > 10000 && input.resource !== "brand_analytics") throw new McpDatasetError("PAGE_OUT_OF_RANGE", "该数据域查询页码最多 10000。");
  if (input.page > 100000) throw new McpDatasetError("PAGE_OUT_OF_RANGE", "查询页码最多 100000。");
  const source = candidates[0];
  const { sortBy: _sortBy, sortDirection: _sortDirection, ...filters } = input.filters;
  void _sortBy; void _sortDirection;
  const params = new URLSearchParams({ ...filters, sourceId: source.id, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: input.resource, page: String(input.page), pageSize: String(input.pageSize) });
  const result = input.resource === "orders" ? await readOrders(input.scope, params, input.actor)
    : input.resource === "finance" ? await readFinance(input.scope, params, input.actor)
    : input.resource === "returns" ? await readReturns(input.scope, params, input.actor)
    : ["settlements", "reimbursements", "inventory_age", "inventory_events"].includes(input.resource) ? await readDomainReports(input.scope, params, input.actor)
    : input.resource === "brand_analytics" ? await readBrandAnalytics(input.scope, params, input.actor)
    : await readObservations(input.scope, params, input.actor);
  return { rows: result.rows, pagination: result.pagination, source,
    // Do not copy configuration, seller-wide quarantine totals or internal manifests.
    completeness: "completeness" in result ? result.completeness : "PUBLISHED_VERSION_ONLY" };
}
