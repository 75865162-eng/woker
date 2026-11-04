import { amazonDataAccess, type AmazonDataAccess } from "./data-access";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { businessDate } from "./date-range";
import { SyncInputError, type SyncScope } from "./policy";

export type SalesQuery = { from?: string; to?: string; sellerAccountId?: string; marketplaceId?: string; taskId?: string; keyword?: string; direction: "asc" | "desc" };
export function parseSalesQuery(p: URLSearchParams): SalesQuery {
  for (const key of ["sku", "asin", "orderId"]) if (p.get(key)) throw new SyncInputError("当前报告为店铺逐日汇总，不支持 SKU / ASIN / Order ID 筛选。");
  const from = p.get("from") ? businessDate(p.get("from")) : undefined, to = p.get("to") ? businessDate(p.get("to")) : undefined;
  if (from && to && from > to) throw new SyncInputError("业务日期范围倒置。");
  if (p.get("sort") && p.get("sort") !== "businessDate") throw new SyncInputError("仅支持业务日期排序。");
  if (p.get("quality") && p.get("quality") !== "VALID") throw new SyncInputError("正式查询仅返回完整有效版本；异常请查看任务质量记录。");
  if (p.get("status") && p.get("status") !== "SUCCEEDED") throw new SyncInputError("正式查询仅返回成功发布的数据。");
  if (p.get("direction") && !["asc", "desc"].includes(p.get("direction")!)) throw new SyncInputError("排序方向无效。");
  const text = (key: string) => { const v = p.get(key)?.trim(); if (v && v.length > 200) throw new SyncInputError("筛选条件过长。"); return v || undefined; };
  return { from, to, sellerAccountId: text("sellerAccountId"), marketplaceId: text("marketplaceId"), taskId: text("taskId"), keyword: text("keyword"), direction: p.get("direction") === "asc" ? "asc" : "desc" };
}
/** Every business day resolves independently, so a new small window cannot hide older dates. */
export function salesVersionSql(scope: SyncScope, query: SalesQuery, cutoff: Date, access?: AmazonDataAccess, sourceFence?: string[]) {
  return Prisma.sql`WITH versions AS (
    SELECT DISTINCT ON (r."sourceId", r."businessDate") r.*, t."finishedAt" AS "publishedAt", t."frozenScope", t.summary,
      s."authorizationId", a."amazonSellerId", seller."displayName" AS "sellerName"
    FROM "AmazonSalesTrafficSnapshot" r
    JOIN "AmazonSyncRun" t ON t.id = r."syncRunId" AND t."organizationId" = r."organizationId" AND t."workspaceId" = r."workspaceId" AND t."sourceId" = r."sourceId"
    JOIN "AmazonSyncDataSource" s ON s.id = r."sourceId" AND s."organizationId" = r."organizationId" AND s."workspaceId" = r."workspaceId"
    JOIN "AmazonSpApiAuthorization" a ON a.id = s."authorizationId" AND a."organizationId" = r."organizationId" AND a."workspaceId" = r."workspaceId"
    JOIN "SellerAccount" seller ON seller.id = r."sellerAccountId" AND seller."organizationId" = r."organizationId" AND seller."workspaceId" = r."workspaceId"
    WHERE r."organizationId" = ${scope.organizationId} AND r."workspaceId" = ${scope.workspaceId}
      AND r."sellerAccountId" = s."sellerAccountId" AND r."marketplaceId" = s."marketplaceId"
      ${access && !access.allSellers ? (access.sellerIds.length ? Prisma.sql`AND r."sellerAccountId" IN (${Prisma.join(access.sellerIds)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
      ${access?.scopes ? access.scopes.length ? Prisma.sql`AND (${Prisma.join(access.scopes.map(s => Prisma.sql`(r."sellerAccountId" = ${s.sellerAccountId} ${s.marketplaceIds.length ? Prisma.sql`AND r."marketplaceId" IN (${Prisma.join(s.marketplaceIds)})` : Prisma.empty})`), " OR ")})` : Prisma.sql`AND FALSE` : Prisma.empty}
      ${sourceFence !== undefined ? sourceFence.length ? Prisma.sql`AND r."sourceId" IN (${Prisma.join(sourceFence)})` : Prisma.sql`AND FALSE` : Prisma.empty}
      AND s.resource = 'sales_traffic' AND t.status = 'SUCCEEDED' AND t."executionVersion" = 2 AND t.resource = 'sales_traffic' AND t.stage <> 'PURGED' AND r.quality = 'VALID' AND t."finishedAt" <= ${cutoff}
      ${query.from ? Prisma.sql`AND r."businessDate" >= ${query.from}` : Prisma.empty}
      ${query.to ? Prisma.sql`AND r."businessDate" <= ${query.to}` : Prisma.empty}
      ${query.sellerAccountId ? Prisma.sql`AND r."sellerAccountId" = ${query.sellerAccountId}` : Prisma.empty}
      ${query.marketplaceId ? Prisma.sql`AND r."marketplaceId" = ${query.marketplaceId}` : Prisma.empty}
      ${query.taskId ? Prisma.sql`AND r."syncRunId" = ${query.taskId}` : Prisma.empty}
    ORDER BY r."sourceId", r."businessDate", t."finishedAt" DESC, t.id DESC
  ), filtered AS (
    SELECT * FROM versions
    ${query.keyword ? Prisma.sql`WHERE position(lower(${query.keyword}) in lower("sellerName" || ' ' || "amazonSellerId" || ' ' || "marketplaceId")) > 0` : Prisma.empty}
  )`;
}
export type SalesRow = { id: string; organizationId: string; workspaceId: string; sourceId: string; syncRunId: string; sellerAccountId: string; marketplaceId: string; businessDate: string; reportId: string; documentId: string; metrics: { unitsOrdered: number | null; totalOrderItems: number | null; sessions: number | null; pageViews: number | null; orderedProductSales: { amount: number; currencyCode: string } | null }; quality: string; capturedAt: Date; publishedAt: Date; amazonSellerId: string; sellerName: string; frozenScope: unknown; summary: unknown };
export async function readSalesTraffic(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; pageSize?: number; actor?: string; sellerFence?: string[]; sourceFence?: string[]; action?: "view" | "export" } = {}) {
  let access = await amazonDataAccess(scope, options.actor, prisma, options.action ?? "view");
  if (options.sellerFence) access = { allSellers: false, sellerIds: access.allSellers ? options.sellerFence : options.sellerFence.filter(id => access.sellerIds.includes(id)), ...(access.scopes ? { scopes: access.scopes.filter(s => options.sellerFence!.includes(s.sellerAccountId)) } : {}) };
  const query = parseSalesQuery(p), cutoff = options.cutoff ?? new Date(), cte = salesVersionSql(scope, query, cutoff, access, options.sourceFence);
  const page = Math.min(10000, Math.max(1, Math.floor(Number(p.get("page")) || 1))), pageSize = options.pageSize ?? 50;
  return prisma.$transaction(async tx => {
    const total = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`${cte} SELECT count(*) FROM filtered`);
    const rows = await tx.$queryRaw<SalesRow[]>(Prisma.sql`${cte} SELECT * FROM filtered ORDER BY "businessDate" ${query.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, "sourceId", id OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`);
    return { rows, pagination: { page, pageSize, total: Number(total[0].count), pageCount: Math.ceil(Number(total[0].count) / pageSize) }, query, asOf: cutoff.toISOString(), dateField: "report_business_date", granularity: "SELLER_DAY", versionPolicy: query.taskId ? "historical_task" : "latest_successful_per_source_day" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
