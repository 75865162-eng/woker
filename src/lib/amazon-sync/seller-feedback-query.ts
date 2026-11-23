/** 卖家反馈（GET_SELLER_FEEDBACK_DATA）只读查询：权限与版本口径复用 read-account；按反馈日/星级/订单过滤；不补零。 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import { SyncInputError, type SyncScope } from "./policy";

export type SellerFeedbackRow = {
  id: string; organizationId: string; workspaceId: string; sourceId: string; syncRunId: string;
  sellerAccountId: string; marketplaceId: string; reportId: string; documentId: string;
  feedbackDate: string; rating: number; comments: string; response: string;
  amazonOrderId: string | null; capturedAt: Date; sellerName: string; amazonSellerId: string;
};
export type SellerFeedbackResult = {
  rows: SellerFeedbackRow[]; pagination: { page: number; pageSize: number; total: number; pageCount: number };
  asOf: string; granularity: "FEEDBACK_DETAIL"; summary: { total: number; negative: number; neutral: number; positive: number; replied: number; buyerEmailAvailable: false };
};

const FEEDBACK_MAX_PAGE_SIZE = 500;
export async function readSellerFeedback(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; actor?: string } = {}) {
  p = new URLSearchParams(p);
  const access = await amazonAccountReadAccess(scope, options.actor, p, prisma, "seller_feedback");
  const from = p.get("from"), to = p.get("to");
  if (from && to && from > to) throw new SyncInputError("日期范围倒置。");
  const rating = p.get("rating");
  if (rating && !["1", "2", "3", "4", "5"].includes(rating)) throw new SyncInputError("星级筛选无效。");
  const keyword = p.get("keyword")?.trim() ?? "";
  if (keyword.length > 200) throw new SyncInputError("筛选条件过长。");
  const sellerAccountId = access.sellerIds[0];
  const page = Math.min(10000, Math.max(1, Math.floor(Number(p.get("page")) || 1))), pageSize = Math.min(FEEDBACK_MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(p.get("pageSize")) || 50)));
  const where = {
    organizationId: scope.organizationId, workspaceId: scope.workspaceId,
    sellerAccountId: { in: access.allSellers ? access.sellerIds.length ? access.sellerIds : [""] : access.sellerIds },
    ...(sellerAccountId ? { sellerAccountId } : {}),
    ...(p.get("marketplaceId") ? { marketplaceId: p.get("marketplaceId")! } : {}),
    ...(from || to ? { feedbackDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(rating ? { rating: Number(rating) } : {}),
    ...(keyword ? { OR: [{ comments: { contains: keyword, mode: "insensitive" as const } }, { response: { contains: keyword, mode: "insensitive" as const } }, { amazonOrderId: { contains: keyword } }] } : {}),
  };
  const cutoff = options.cutoff ?? new Date();
  const result = await prisma.$transaction(async tx => {
    const total = await tx.amazonSellerFeedbackSnapshot.count({ where });
    const rows = await tx.amazonSellerFeedbackSnapshot.findMany({
      where,
      orderBy: [{ feedbackDate: "desc" }, { rating: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, organizationId: true, workspaceId: true, sourceId: true, syncRunId: true, sellerAccountId: true, marketplaceId: true, reportId: true, documentId: true, feedbackDate: true, rating: true, comments: true, response: true, amazonOrderId: true, capturedAt: true, source: { select: { authorization: { select: { amazonSellerId: true } }, seller: { select: { displayName: true } } } } },
    });
    // 汇总（仅当前筛选范围，不分页）：差评率/回复率基于真实明细行。
    const summaryRows = await tx.amazonSellerFeedbackSnapshot.groupBy({ by: ["rating"], where, _count: { _all: true } });
    const replied = await tx.amazonSellerFeedbackSnapshot.count({ where: { ...where, response: { not: "" } } });
    const counts = new Map(summaryRows.map(r => [r.rating, r._count._all]));
    const all = summaryRows.reduce((sum, r) => sum + r._count._all, 0);
    return { total, rows, summary: { total: all, negative: (counts.get(1) ?? 0) + (counts.get(2) ?? 0), neutral: counts.get(3) ?? 0, positive: (counts.get(4) ?? 0) + (counts.get(5) ?? 0), replied } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, options.actor, p, prisma, "seller_feedback");
  return {
    rows: result.rows.map(({ source, ...row }) => ({ ...row, amazonSellerId: source.authorization.amazonSellerId, sellerName: source.seller.displayName })),
    pagination: { page, pageSize, total: result.total, pageCount: Math.ceil(result.total / pageSize) },
    asOf: cutoff.toISOString(), granularity: "FEEDBACK_DETAIL" as const,
    summary: { ...result.summary, buyerEmailAvailable: false as const },
  };
}
