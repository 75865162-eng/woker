/**
 * Amazon 本地承接池「原始落地行」封闭目录。
 *
 * 与 mcp-datasets.ts 的区别（口径必须分开，不能混算）：
 * - mcp-datasets.ts / data_query：已发布、已验证数据源的【业务事实】，字段与粒度经过契约确认。
 * - 本目录：数据库里【真实存在的物理表整行】，包含采集过程、同步链路与未发布行。
 *   它没有「已发布」语义，缺失不代表业务为零，也不能与业务事实同列相加。
 *
 * 边界：
 * - 表名是服务端静态封闭清单，永远不接受客户端拼表名；只认 `Amazon*` 前缀。
 * - 列名在运行时从 information_schema 读取真实物理列，不猜字段、不补零。
 * - 凭证/密钥/认证/加密原件/无租户列的表不纳入；仍在 tables 输出里如实列出并给出原因。
 * - 每张可读表强制 organizationId + workspaceId + 单账号单站点围栏，敏感列不返回。
 */
import { assertProviderTable } from "@/lib/mcp/isolation";

/** 允许全字段只读的真实物理表（均有 organizationId + workspaceId 租户列）。 */
export const amazonLocalRawTables = [
  "AmazonSellerBinding",
  "AmazonAdsProfile",
  "AmazonAdsSyncPlan",
  "AmazonAdsSyncTask",
  "AmazonAdsEntityRecord",
  "AmazonAdsSyncDomainState",
  "AmazonAdsSyncAttempt",
  "AmazonAdsReportVersion",
  "AmazonAdsReportFact",
  "AmazonAdsReportRequest",
  "AmazonAdsReportDocument",
  "AmazonAdsChangeDraft",
  "AmazonAdsEntityHistory",
  "AmazonSyncRun",
  "AmazonSyncSchedule",
  "AmazonSyncPlanTarget",
  "AmazonSyncTaskLog",
  "AmazonSyncApiBudget",
  "AmazonSyncResourceCursor",
  "AmazonSyncDataSource",
  "AmazonDataSourceRegistry",
  "AmazonSellerIdentity",
  "AmazonInventorySnapshot",
  "AmazonCatalogSnapshot",
  "AmazonCatalogImageReference",
  "AmazonSalesTrafficSnapshot",
  "AmazonSyncReportDocument",
  "AmazonSyncReportRow",
  "AmazonOrderRecord",
  "AmazonOrderItemRecord",
  "AmazonOrderDetailWork",
  "AmazonFinanceRecord",
  "AmazonReturnReason",
  "AmazonReturnRecord",
  "AmazonSettlementReport",
  "AmazonSettlementRow",
  "AmazonDomainObservation",
  "AmazonFieldMappingVersion",
  "AmazonFieldObservation",
  "AmazonReplenishmentPolicy",
  "AmazonReplenishmentPlan",
  "AmazonDataExport",
  "AmazonDataAccessGrant",
  "AmazonRoleDataAccessGrant",
  "AmazonAgentActionAudit",
] as const;
export type AmazonLocalRawTable = (typeof amazonLocalRawTables)[number];

/** 系统安全边界：这些表不是「同步到本地承接页的数据」，不通过通用原始行工具暴露。 */
export const amazonLocalRawExcluded = [
  { table: "AmazonSettlementAllocation", reason: "FINANCE_ACTION_REQUIRED", alternative: "结算分摊工作台" },
  { table: "AmazonSettlementAllocationLine", reason: "FINANCE_ACTION_REQUIRED", alternative: "结算分摊工作台" },
  { table: "AmazonIntegrationConnection", reason: "CREDENTIAL_STORE", alternative: "授权管理页" },
  { table: "AmazonIntegrationSecret", reason: "CREDENTIAL_STORE", alternative: "授权管理页" },
  { table: "AmazonAdsAuthorization", reason: "CREDENTIAL_STORE", alternative: "Ads 授权管理页" },
  { table: "AmazonSpApiAuthorization", reason: "CREDENTIAL_STORE", alternative: "SP-API 授权管理页" },
  { table: "AmazonMcpCredential", reason: "CREDENTIAL_STORE", alternative: "MCP 凭证管理页" },
  { table: "AmazonOAuthAttempt", reason: "AUTH_ATTEMPT", alternative: null },
  { table: "AmazonAdsOAuthAttempt", reason: "AUTH_ATTEMPT", alternative: null },
  { table: "AmazonDataCenterSealedCommand", reason: "SEALED_COMMAND", alternative: null },
  { table: "AmazonDataCenterChangeRequest", reason: "CHANGE_APPROVAL", alternative: "变更审批页" },
  { table: "AmazonDataCenterConfigVersion", reason: "INTERNAL_CONFIG", alternative: null },
  { table: "AmazonFinanceQuarantine", reason: "CIPHERTEXT_ONLY", alternative: null },
  { table: "AmazonSyncRawPage", reason: "ENCRYPTED_RAW_PAGE", alternative: "amazon.data.archive.read（受控解密）" },
  { table: "AmazonSyncPage", reason: "PAGINATION_CURSOR", alternative: null },
  { table: "AmazonCatalogImageBlob", reason: "BINARY_BLOB", alternative: "商品图片引用表" },
  { table: "AmazonFieldRegistry", reason: "INTERNAL_FIELD_REGISTRY", alternative: "amazon.fields.catalog" },
] as const;

/** 无租户列的进程级表：无法做租户围栏，任何情况下都不开放。 */
export const amazonLocalRawUnscoped = ["AmazonAdsApiBudget", "AmazonSyncTokenBucket"] as const;

/** 密文/令牌/凭证类列；内容哈希（rowHash 等）保留，用于可追溯性校验。 */
export const amazonLocalSensitiveColumn = /cipher|secret|token|refresh|credential|password|privateKey|accessKey/i;

/** 嵌套 JSON 仍可能带凭据或个人信息；原始承接不等于原样向客户端披露。 */
export function redactAmazonLocalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAmazonLocalValue);
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /cipher|secret|token|credential|password|authorization|private.?key|access.?key|email|phone|address|buyer.?name/i.test(key)
      ? "[REDACTED]" : redactAmazonLocalValue(item)]));
}

/** 排序用的时间列优先级；都不存在时退回主键。 */
export const amazonLocalDateColumns = [
  "capturedAt", "reportDate", "businessDate", "postedAt", "eventDate", "approvalDate",
  "publishedAt", "syncedAt", "lastSuccessAt", "createdAt", "updatedAt",
] as const;

export type AmazonLocalScopeMode = "store" | "profile" | "source" | "tenant_only";

/** 按真实物理列决定围栏方式；优先级 store > profile > source。 */
export function amazonLocalScopeMode(columns: readonly string[]): AmazonLocalScopeMode {
  const has = (column: string) => columns.includes(column);
  if (has("sellerAccountId") && has("marketplaceId")) return "store";
  if (has("profileId")) return "profile";
  if (has("sourceId")) return "source";
  return "tenant_only";
}

export function amazonLocalOrderColumn(columns: readonly string[]) {
  return amazonLocalDateColumns.find(column => columns.includes(column))
    ?? (columns.includes("id") ? "id" : columns[0])
    ?? "id";
}

export function amazonLocalVisibleColumns(columns: readonly string[]) {
  return columns.filter(column => !amazonLocalSensitiveColumn.test(column));
}

/** 封闭清单 + Amazon 表前缀双重校验；失败即拒绝，绝不放行任意表名。 */
export function assertAmazonLocalTable(table: string): asserts table is AmazonLocalRawTable {
  assertProviderTable("amazon", table, amazonLocalRawTables);
}

export const amazonLocalRawDisclosure = {
  provider: "amazon",
  dataClass: "RAW_LOCAL_ROWS",
  publicationStatus: "NOT_PUBLISHED_FACTS",
  warnings: [
    "原始落地行不等于已发布业务事实：未发布、失败任务已提交行、采集过程行都可能在此，缺失行不代表业务为零。",
    "不得与 data_query / 已发布报表口径同列相加，也不得与赛狐承接池数据混算。",
    "金额与大整数按原始类型返回，可能是精确字符串或 Decimal；不做换算、不补零。",
    "敏感列（密文/令牌/凭证）在 SQL 投影层即被剔除，不会离开服务端。",
  ],
} as const;
