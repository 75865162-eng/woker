import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "@/lib/db/prisma";
import { SyncInputError } from "./policy";
import {
  amazonLocalRawDisclosure, amazonLocalRawExcluded, amazonLocalRawTables, amazonLocalRawUnscoped,
  amazonLocalOrderColumn, amazonLocalScopeMode, amazonLocalSensitiveColumn, amazonLocalVisibleColumns,
  assertAmazonLocalTable, redactAmazonLocalValue, type AmazonLocalScopeMode,
} from "./local-raw-catalog";

/**
 * Amazon 本地承接池原始落地行的只读服务。
 *
 * 复用仓库既有的只读事务边界（SET TRANSACTION READ ONLY + RepeatableRead）。
 * 配置了 AMAZON_MCP_PG_READONLY_URL 时走独立只读角色连接；否则回退主连接，
 * 只读仍由事务强制，绝不回退到无事务写入路径。调用方负责先完成账号授权校验；
 * 这里再强制做一次 organizationId / workspaceId / 单账号单站点围栏。
 */
export type AmazonLocalScope = { organizationId: string; workspaceId: string };
/** tenantWide 由调用方在完成全店铺授权校验后传入；复用现有 allSellers，不新增权限体系。 */
export type AmazonLocalFence = { sellerAccountId: string; marketplaceId: string; tenantWide?: boolean };

const MAX_PAGE_SIZE = 1000;
const MAX_PAGE = 10_000;

const globalForAmazonRo = globalThis as unknown as { amazonMcpReadonlyClient?: PrismaClient };
/** 双池连接隔离：有独立只读角色就用它，没有则沿用主连接 + 只读事务。 */
function amazonReadClient() {
  const url = process.env.AMAZON_MCP_PG_READONLY_URL?.trim();
  if (!url) return prisma;
  // Prisma 7 用 driver adapter；连接本身即只读，事务里再强制一次 READ ONLY。
  globalForAmazonRo.amazonMcpReadonlyClient ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=15000" }),
  });
  return globalForAmazonRo.amazonMcpReadonlyClient;
}

/** 标识符只来自静态封闭清单或 information_schema 的真实列名。 */
function ident(name: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new SyncInputError("数据列标识无效。", 400);
  return Prisma.raw(`"${name}"`);
}

function integer(value: unknown, fallback: number, max: number) {
  const actual = value === undefined ? fallback : value;
  if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual < 1 || actual > max) {
    throw new SyncInputError("分页参数无效或超过上限。", 400);
  }
  return actual;
}

type PhysicalTable = { columns: string[]; types: Record<string, string> };

/** 真实物理列与列类型来自 information_schema，绝不根据业务猜测字段或类型。 */
async function physicalColumns(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ tableName: string; columns: string[]; dataTypes: string[] }>>(Prisma.sql`
    SELECT table_name::text AS "tableName",
           array_agg(column_name::text ORDER BY ordinal_position) AS "columns",
           array_agg(data_type::text ORDER BY ordinal_position) AS "dataTypes"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (${Prisma.join([...amazonLocalRawTables])})
    GROUP BY table_name`);
  return new Map<string, PhysicalTable>(rows.map(row => [row.tableName, {
    columns: row.columns,
    types: Object.fromEntries(row.columns.map((column, index) => [column, row.dataTypes[index] ?? "unknown"])),
  }]));
}

function dateText(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new SyncInputError(`${label} 须为 YYYY-MM-DD。`, 400);
  return value;
}

/** 时间范围比较按真实列类型生成：TEXT 用文本比较，date/timestamp 用含当天的日期边界。 */
function dateClauses(column: string, type: string | undefined, from?: string, to?: string) {
  const ref = Prisma.sql`t.${ident(column)}`;
  const isText = ["text", "character varying", "character"].includes(type ?? "");
  const clauses: Prisma.Sql[] = [];
  if (from) clauses.push(isText ? Prisma.sql`${ref} >= ${from}::text` : Prisma.sql`${ref} >= ${from}::date`);
  if (to) clauses.push(isText ? Prisma.sql`${ref} <= ${to}::text` : Prisma.sql`${ref} < (${to}::date + 1)`);
  return clauses;
}

/** 四选一围栏：表自带店铺列 / 经 Ads Profile 反查 / 经同步数据源反查 / 租户级表。
 *  tenant_only 表只有 organizationId+workspaceId，无法按 Seller Account 切分；
 *  只有全店铺授权（tenantWide）才按租户围栏开放，单账号凭证不能看全租户。 */
function fenceWhere(scope: AmazonLocalScope, fence: AmazonLocalFence, mode: AmazonLocalScopeMode) {
  const tenant = Prisma.sql`t."organizationId" = ${scope.organizationId} AND t."workspaceId" = ${scope.workspaceId}`;
  if (mode === "store") {
    return Prisma.sql`${tenant} AND t."sellerAccountId" = ${fence.sellerAccountId} AND t."marketplaceId" = ${fence.marketplaceId}`;
  }
  if (mode === "profile") {
    return Prisma.sql`${tenant} AND EXISTS (SELECT 1 FROM "AmazonAdsProfile" p WHERE p."id" = t."profileId"
      AND p."organizationId" = ${scope.organizationId} AND p."workspaceId" = ${scope.workspaceId}
      AND p."sellerAccountId" = ${fence.sellerAccountId} AND p."marketplaceId" = ${fence.marketplaceId})`;
  }
  if (mode === "source") {
    return Prisma.sql`${tenant} AND EXISTS (SELECT 1 FROM "AmazonSyncDataSource" s WHERE s."id" = t."sourceId"
      AND s."organizationId" = ${scope.organizationId} AND s."workspaceId" = ${scope.workspaceId}
      AND s."sellerAccountId" = ${fence.sellerAccountId} AND s."marketplaceId" = ${fence.marketplaceId})`;
  }
  if (mode === "tenant_only" && fence.tenantWide) return tenant;
  throw new SyncInputError("该表没有店铺围栏列，不开放原始行读取。", 403);
}

const readOnlyTransaction = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 };

/** 列出全部真实物理表、真实列清单与按授权围栏计算出的精确行数。 */
export async function listAmazonLocalRawTables(scope: AmazonLocalScope, fence: AmazonLocalFence) {
  return amazonReadClient().$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '15000ms'`;
    const columnsByTable = await physicalColumns(tx);
    const counts = amazonLocalRawTables.map(table => {
      const columns = columnsByTable.get(table)?.columns ?? [];
      const mode = amazonLocalScopeMode(columns);
      if (!columns.length || (mode === "tenant_only" && !fence.tenantWide)) {
        return Prisma.sql`SELECT ${table}::text AS "tableName", NULL::bigint AS "rows"`;
      }
      const where = fenceWhere(scope, fence, mode);
      return Prisma.sql`SELECT ${table}::text AS "tableName", (SELECT count(*) FROM ${ident(table)} t WHERE ${where})::bigint AS "rows"`;
    });
    const countsResult = await tx.$queryRaw<Array<{ tableName: string; rows: bigint | null }>>(
      Prisma.sql`${Prisma.join(counts, " UNION ALL ")}`,
    );
    const countMap = new Map(countsResult.map(row => [row.tableName, row.rows === null ? null : Number(row.rows)]));
    const tables = amazonLocalRawTables.map(table => {
      const columns = columnsByTable.get(table)?.columns ?? [];
      const mode = amazonLocalScopeMode(columns);
      const readable = columns.length > 0 && (mode !== "tenant_only" || fence.tenantWide === true);
      return {
        table, scopeMode: mode, physicalTableExists: columns.length > 0,
        columns: amazonLocalVisibleColumns(columns),
        excludedColumns: columns.filter(column => amazonLocalSensitiveColumn.test(column)),
        orderColumn: columns.length ? amazonLocalOrderColumn(columns) : null,
        readable,
        ...(readable ? {} : { readBlockedReason: !columns.length ? "TABLE_NOT_PRESENT"
          : mode === "tenant_only" ? "TENANT_WIDE_REQUIRES_ALL_SELLERS" : "NO_STORE_FENCE" }),
        rows: countMap.get(table) ?? null,
        rowCountBasis: "EXACT_COUNT_WITHIN_TENANT_AND_STORE_FENCE",
      };
    });
    return {
      ...amazonLocalRawDisclosure, scope: fence,
      tables, excluded: amazonLocalRawExcluded, unscoped: amazonLocalRawUnscoped,
      totals: {
        catalogTables: tables.length,
        readableTables: tables.filter(table => table.readable).length,
        physicalTablesPresent: tables.filter(table => table.physicalTableExists).length,
        rowsWithinScope: tables.reduce((sum, table) => sum + (table.rows ?? 0), 0),
      },
      meta: { source: "information_schema + local physical tables", isSandbox: false, isDemo: false,
        schemaStatus: "PHYSICAL_SCHEMA_OBSERVED", observedAt: new Date().toISOString(),
        publicationStatus: "NOT_PUBLISHED_FACTS", rowCountBasis: "EXACT_COUNT_WITHIN_TENANT_AND_STORE_FENCE" },
    };
  }, readOnlyTransaction);
}

/** 读取单张封闭清单内物理表的整行全部可见物理字段。时间范围/排序/过滤均受封闭列清单约束。 */
export async function readAmazonLocalRawRows(
  scope: AmazonLocalScope,
  fence: AmazonLocalFence,
  input: {
    table: string; page?: number; pageSize?: number;
    fromDate?: unknown; toDate?: unknown; sortDirection?: unknown;
    filterColumn?: unknown; filterValue?: unknown;
  },
) {
  assertAmazonLocalTable(input.table);
  const table = input.table;
  const page = integer(input.page, 1, MAX_PAGE);
  const pageSize = integer(input.pageSize, 100, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  const from = input.fromDate === undefined ? undefined : dateText(input.fromDate, "fromDate");
  const to = input.toDate === undefined ? undefined : dateText(input.toDate, "toDate");
  const direction = input.sortDirection === "asc" ? "ASC" : "DESC";
  const filterColumn = input.filterColumn === undefined ? undefined : String(input.filterColumn);
  const filterValue = input.filterValue === undefined ? undefined : String(input.filterValue);
  if (filterColumn && !/^[A-Za-z][A-Za-z0-9_]*$/.test(filterColumn)) throw new SyncInputError("过滤列标识无效。", 400);
  if (Boolean(filterColumn) !== Boolean(filterValue) || (filterValue && filterValue.length > 200)) {
    throw new SyncInputError("过滤列与过滤值必须同时提供，且过滤值不超过 200 字符。", 400);
  }
  return amazonReadClient().$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '15000ms'`;
    const columnsByTable = await physicalColumns(tx);
    const physical = columnsByTable.get(table);
    const columns = physical?.columns ?? [];
    if (!columns.length) throw new SyncInputError("该物理表在当前数据库不存在或没有可见列。", 409);
    const mode = amazonLocalScopeMode(columns);
    const orderColumn = amazonLocalOrderColumn(columns);
    const visible = amazonLocalVisibleColumns(columns);
    if (!visible.length) throw new SyncInputError("该表没有可返回的字段。", 409);
    if (filterColumn && !visible.includes(filterColumn)) throw new SyncInputError("过滤列不在该表的可见物理列中。", 400);
    const where = Prisma.join([
      fenceWhere(scope, fence, mode),
      ...dateClauses(orderColumn, physical?.types[orderColumn], from, to),
      ...(filterColumn && filterValue ? [Prisma.sql`t.${ident(filterColumn)}::text = ${filterValue}::text`] : []),
    ], " AND ");
    const projection = Prisma.join(visible.map(column => Prisma.sql`t.${ident(column)}`));
    const [countRow] = await tx.$queryRaw<Array<{ n: bigint; latest: string | null }>>(
      Prisma.sql`SELECT count(*)::bigint AS "n", max(t.${ident(orderColumn)})::text AS "latest" FROM ${ident(table)} t WHERE ${where}`,
    );
    const total = Number(countRow?.n ?? 0n);
    const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`SELECT ${projection} FROM ${ident(table)} t WHERE ${where} ORDER BY t.${ident(orderColumn)} ${Prisma.raw(direction)} NULLS LAST LIMIT ${pageSize} OFFSET ${offset}`,
    );
    return {
      ...amazonLocalRawDisclosure, scope: fence,
      table, scopeMode: mode, orderColumn, orderColumnType: physical?.types[orderColumn] ?? "unknown",
      sortDirection: direction === "ASC" ? "asc" : "desc",
      columns: visible,
      excludedColumns: columns.filter(column => amazonLocalSensitiveColumn.test(column)),
      data: { items: rows.map(row => redactAmazonLocalValue(row)), total },
      pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize), hasNext: page * pageSize < total },
      meta: { source: table, isSandbox: false, isDemo: false, schemaStatus: "PHYSICAL_SCHEMA_OBSERVED",
        rowCountBasis: "EXACT_COUNT_WITHIN_TENANT_AND_STORE_FENCE",
        latestDate: countRow?.latest ?? null, latestDateBasis: `MAX(${orderColumn})`,
        observedAt: new Date().toISOString(),
        dateRangeApplied: { from: from ?? null, to: to ?? null },
        filterApplied: filterColumn ? { column: filterColumn } : null },
    };
  }, readOnlyTransaction);
}
