import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SyncInputError } from "./policy";
import {
  amazonLocalRawDisclosure, amazonLocalRawExcluded, amazonLocalRawTables, amazonLocalRawUnscoped,
  amazonLocalOrderColumn, amazonLocalScopeMode, amazonLocalSensitiveColumn, amazonLocalVisibleColumns,
  assertAmazonLocalTable, type AmazonLocalScopeMode,
} from "./local-raw-catalog";

/**
 * Amazon 本地承接池原始落地行的只读服务。
 *
 * 复用仓库既有的只读事务边界（SET TRANSACTION READ ONLY + RepeatableRead），
 * 不新建数据库连接、不引入新的环境变量。调用方负责先完成账号授权校验；
 * 这里再强制做一次 organizationId / workspaceId / 单账号单站点围栏。
 */
export type AmazonLocalScope = { organizationId: string; workspaceId: string };
export type AmazonLocalFence = { sellerAccountId: string; marketplaceId: string };

const MAX_PAGE_SIZE = 1000;
const MAX_PAGE = 10_000;

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

/** 真实物理列来自 information_schema，绝不根据业务猜测字段。 */
async function physicalColumns(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ tableName: string; columns: string[] }>>(Prisma.sql`
    SELECT table_name::text AS "tableName",
           array_agg(column_name::text ORDER BY ordinal_position) AS "columns"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (${Prisma.join([...amazonLocalRawTables])})
    GROUP BY table_name`);
  return new Map(rows.map(row => [row.tableName, row.columns]));
}

/** 三选一围栏：表自带店铺列 / 经 Ads Profile 反查 / 经同步数据源反查。tenant_only 直接拒绝。 */
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
  throw new SyncInputError("该表没有店铺围栏列，不开放原始行读取。", 403);
}

const readOnlyTransaction = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 };

/** 列出全部真实物理表、真实列清单与按授权围栏计算出的精确行数。 */
export async function listAmazonLocalRawTables(scope: AmazonLocalScope, fence: AmazonLocalFence) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '15000ms'`;
    const columnsByTable = await physicalColumns(tx);
    const counts = amazonLocalRawTables.map(table => {
      const columns = columnsByTable.get(table) ?? [];
      const mode = amazonLocalScopeMode(columns);
      if (mode === "tenant_only" || !columns.length) {
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
      const columns = columnsByTable.get(table) ?? [];
      const mode = amazonLocalScopeMode(columns);
      const readable = columns.length > 0 && mode !== "tenant_only";
      return {
        table, scopeMode: mode, physicalTableExists: columns.length > 0,
        columns: amazonLocalVisibleColumns(columns),
        excludedColumns: columns.filter(column => amazonLocalSensitiveColumn.test(column)),
        orderColumn: columns.length ? amazonLocalOrderColumn(columns) : null,
        readable,
        ...(readable ? {} : { readBlockedReason: !columns.length ? "TABLE_NOT_PRESENT" : "NO_STORE_FENCE" }),
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
      meta: { source: "information_schema + local physical tables", isSandbox: false, isDemo: false, schemaStatus: "PHYSICAL_SCHEMA_OBSERVED" },
    };
  }, readOnlyTransaction);
}

/** 读取单张封闭清单内物理表的整行全部可见物理字段。 */
export async function readAmazonLocalRawRows(
  scope: AmazonLocalScope,
  fence: AmazonLocalFence,
  input: { table: string; page?: number; pageSize?: number },
) {
  assertAmazonLocalTable(input.table);
  const table = input.table;
  const page = integer(input.page, 1, MAX_PAGE);
  const pageSize = integer(input.pageSize, 100, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '15000ms'`;
    const columnsByTable = await physicalColumns(tx);
    const columns = columnsByTable.get(table) ?? [];
    if (!columns.length) throw new SyncInputError("该物理表在当前数据库不存在或没有可见列。", 409);
    const mode = amazonLocalScopeMode(columns);
    const where = fenceWhere(scope, fence, mode);
    const orderColumn = amazonLocalOrderColumn(columns);
    const visible = amazonLocalVisibleColumns(columns);
    if (!visible.length) throw new SyncInputError("该表没有可返回的字段。", 409);
    const projection = Prisma.join(visible.map(column => Prisma.sql`t.${ident(column)}`));
    const [totalRow] = await tx.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT count(*)::bigint AS "n" FROM ${ident(table)} t WHERE ${where}`,
    );
    const total = Number(totalRow?.n ?? 0n);
    const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
      Prisma.sql`SELECT ${projection} FROM ${ident(table)} t WHERE ${where} ORDER BY t.${ident(orderColumn)} DESC LIMIT ${pageSize} OFFSET ${offset}`,
    );
    return {
      ...amazonLocalRawDisclosure, scope: fence,
      table, scopeMode: mode, orderColumn,
      columns: visible,
      excludedColumns: columns.filter(column => amazonLocalSensitiveColumn.test(column)),
      data: { items: rows, total },
      pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize), hasNext: page * pageSize < total },
      meta: { source: table, isSandbox: false, isDemo: false, schemaStatus: "PHYSICAL_SCHEMA_OBSERVED", rowCountBasis: "EXACT_COUNT_WITHIN_TENANT_AND_STORE_FENCE" },
    };
  }, readOnlyTransaction);
}
