import { readOrders, readOrderItems } from "./orders-query";
import { readFinance } from "./finance-query";
import { readReturns } from "./returns-query";
import { readDomainReports } from "./domain-reports-query";
import { readObservations } from "./observations-query";
import { readBrandAnalytics } from "./brand-analytics-query";
import { spApiDataTables } from "./sp-api-datasets";
import { McpDatasetError } from "./mcp-datasets";
import type { SyncScope } from "./policy";
import { reportBusinessFields } from "./report-business-fields";
import { reportPageQuality } from "./report-page-quality";

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
  const promotionKind = input.tableName === "promotions" ? "PROMOTION_SUMMARY" : input.tableName === "promotion_details" ? "PROMOTION" : input.tableName === "promotion_items" ? input.filters.kind === "PROMOTION_SELECTION" ? "PROMOTION_SELECTION" : "PROMOTION_ITEM" : undefined;
  const params = new URLSearchParams({ ...filters, ...(promotionKind ? { kind: promotionKind } : {}), sourceId: source.id, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: input.resource, page: String(input.page), pageSize: String(input.pageSize) });
  const result = input.tableName === "order_items" ? await readOrderItems(input.scope, params, input.actor)
    : input.resource === "orders" ? await readOrders(input.scope, params, input.actor)
    : input.resource === "finance" ? await readFinance(input.scope, params, input.actor)
    : input.resource === "returns" ? await readReturns(input.scope, params, input.actor)
    : ["settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "inventory_events", "removal_order_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "fba_inventory_by_country", "storage_fees", "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory", "recommended_removals", "fba_overage_fees", "fee_preview"].includes(input.resource) ? await readDomainReports(input.scope, params, input.actor)
    : input.resource === "brand_analytics" ? await readBrandAnalytics(input.scope, params, input.actor)
    : await readObservations(input.scope, params, input.actor);
  // Preserve the order reader's coverage independently of row availability.
  // This describes only its current cursor and returned page, never all history.
  const orderSource = "detailsComplete" in result ? result.sources.find(item => item.id === source.id) : undefined;
  const moneyPresent = "detailsComplete" in result ? result.rows.filter(row =>
    ("proceedsOriginal" in row ? row.proceedsOriginal : row.grandTotalOriginal) !== null && row.currencyCode !== null).length : 0;
  const orderCoverage = "detailsComplete" in result ? {
    detailsEnabled: orderSource?.detailsEnabled ?? false,
    recoveryTask: orderSource?.recoveryTask ?? null,
    historicalBackfill: orderSource?.historicalBackfill ?? null,
    historicalBackfillEnabled: orderSource?.historicalBackfillEnabled ?? false,
    historicalBackfillWindow: orderSource?.historicalBackfillWindow ?? null,
    historicalBackfillBasis: "LAST_PUBLISHED_WINDOW",
    moneyRequest: { proceedsRequested: orderSource?.proceedsRequested ?? false, basis: "CURRENT_SOURCE_POLICY" },
    money: {
      field: input.tableName === "order_items" ? "proceedsOriginal" : "grandTotalOriginal",
      returned: result.rows.length,
      present: moneyPresent,
      missing: result.rows.length - moneyPresent,
    },
    window: orderSource?.resourceCursor ? {
      from: orderSource.resourceCursor.watermarkFrom,
      to: orderSource.resourceCursor.watermarkTo,
      status: orderSource.resourceCursor.status,
      listComplete: orderSource.resourceCursor.listComplete,
      detailsComplete: orderSource.detailsComplete,
      lastSuccessAt: orderSource.resourceCursor.lastSuccessAt,
      updatedAt: orderSource.resourceCursor.updatedAt,
    } : null,
    page: {
      returned: result.rows.length,
      detailsCurrent: result.rows.filter(row => row.detailsCurrent).length,
      detailsMissingOrStale: result.rows.filter(row => !row.detailsCurrent).length,
    },
  } : undefined;
  const warnings: string[] = [];
  if ("run" in result && result.run && "summary" in result.run && (result.run.summary as { coverage?: { complete?: boolean } } | null)?.coverage?.complete === false) warnings.push("当前目录为显式批准的部分发布；Amazon 404 对象仍未取得，不能将当前记录解释为全量目录。缺口见 completeness.coverage。");
  if (orderCoverage) {
    if (orderCoverage.historicalBackfill?.deferred) warnings.push("历史订单明细仍有积压，将按后续窗口剩余预算继续补齐；当前窗口完成不代表全历史完整。");
    if (orderCoverage.detailsEnabled && !orderCoverage.moneyRequest.proceedsRequested) warnings.push("当前订单详情策略未请求 PROCEEDS；不能据此判定 Amazon 未提供金额或账号缺少权限，收入补采需先核实并批准相应数据范围。");
    if (orderCoverage.money.missing > 0) warnings.push("当前页存在金额或币种缺失；明细有效不代表收入数据完整，缺失不能解释为零。");
    if (!orderCoverage.detailsEnabled) warnings.push("订单明细采集未启用；空商品列表或金额不能解释为零。");
    if (!orderCoverage.window || orderCoverage.window.status !== "SUCCEEDED") warnings.push("当前订单同步窗口尚未完成；可查询已提交数据，不代表完整历史。");
    if (orderCoverage.detailsEnabled && orderCoverage.page.detailsMissingOrStale > 0) warnings.push("当前返回页存在未采集或已过期的订单明细，不能用于完整商品或金额统计。");
  }
  const reportSource = "source" in result ? result.source : undefined;
  const reportCoverageValue = reportSource && "coverage" in reportSource ? reportSource.coverage : undefined;
  const reportProof = reportCoverageValue && typeof reportCoverageValue === "object" && !Array.isArray(reportCoverageValue) ? reportCoverageValue.rowAttribution : undefined;
  const proofStatus = reportProof && typeof reportProof === "object" && !Array.isArray(reportProof) ? reportProof.status : undefined;
  const reportStatus = "latestTask" in result ? result.latestTask?.status : undefined;
  const reportCoverage = "documents" in result ? {
    coverageStatus: !result.documents.length && (reportStatus === "FAILED" || reportStatus === "BLOCKED") ? "QUERY_FAILED"
      : !result.documents.length && !reportStatus ? "NOT_REQUESTED"
      : proofStatus === "PENDING_VERIFICATION" || proofStatus === "PARTIAL" ? "ATTRIBUTION_PENDING"
      : !result.documents.length ? "NOT_RETURNED" : "HISTORY_INCOMPLETE",
    latestTaskStatus: reportStatus ?? null,
    latestTaskStage: "latestTask" in result ? result.latestTask?.stage ?? null : null,
    failureReason: !result.documents.length && (reportStatus === "FAILED" || reportStatus === "BLOCKED") ? "REPORT_TASK_FAILED_OR_BLOCKED" : null,
    publicationStatus: result.documents.length ? "PUBLISHED_REPORTS_PRESENT" : "NO_PUBLISHED_REPORT",
    historicalUniverseComplete: false,
    emptyMeansNoBusinessEvents: false,
  } : undefined;
  if (reportCoverage) warnings.push("报告行数仅代表当前查询可见结果；失败、未发布、未归因及重叠报告不能解释为没有损失或历史完整。");
  const rows = "documents" in result ? result.rows.map(row => ({ ...row, ...reportBusinessFields(input.resource, row.fields) })) : result.rows;
  return { rows, pagination: result.pagination, source,
    ...("numericEncoding" in result ? { numericEncoding: result.numericEncoding } : {}),
    ...("documents" in result ? { fieldQuality: reportPageQuality(input.resource, rows) } : {}),
    ...(reportCoverage ? { reportCoverage } : {}),
    ...(orderCoverage ? { orderCoverage } : {}), warnings,
    // Do not copy configuration, seller-wide quarantine totals or internal manifests.
    completeness: "completeness" in result ? result.completeness : "PUBLISHED_VERSION_ONLY" };
}
