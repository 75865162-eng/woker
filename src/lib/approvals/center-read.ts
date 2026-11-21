/**
 * 统一审批中心 Reader（赛狐「我审批的/我发起的」全局视图）。
 *
 * 设计约束（对齐任务书 2.8 权限协作 / 8 关键审批审计轨迹）：
 * - 只读聚合现有 5+1 类审批为统一 DTO，绝不在这里做审批动作——
 *   决策仍走各域现有端点（禁自批、revision/hash、expired 校验全部在那里，绝不绕过）；
 * - org+workspace 贯穿，按人过滤（待我审批 = PENDING 且非本人发起；我发起的 = requestedBy=本人）；
 * - 每项给跳转链接到现有工作台，用户点进去用原端点审批；
 * - 任一审批表查询失败只降级该类为空，不影响其它类别；
 * - 不臆造：金额/单号缺失留 null。
 */
import { prisma } from "@/lib/db/prisma";

export type ApprovalView = "toReview" | "myRequests";
export type ApprovalCenterScope = { organizationId: string; workspaceId: string; userId: string };

export type ApprovalItem = {
  id: string;
  category: string;
  categoryLabel: string;
  reference: string | null;
  status: string;
  requestedBy: string;
  amount: number | null;
  currency: string | null;
  createdAt: string;
  expiresAt: string | null;
  href: string;
};

export type ApprovalCenterData = {
  generatedAt: string;
  view: ApprovalView;
  items: ApprovalItem[];
  counts: Record<string, number>;
  degraded: string[];
};

type Deps = { prisma?: typeof prisma; now?: Date };
type RawRow = {
  id: string;
  ref: string | null;
  status: string;
  requestedBy: string;
  amount: unknown;
  currency: string | null;
  createdAt: Date;
  expiresAt: Date | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  wms: "仓库作业",
  purchaseOrder: "采购单",
  purchasePayment: "采购付款",
  purchasePlan: "采购计划",
  purchaseInvoice: "采购发票",
  financeClose: "财务关账",
};

function toItem(category: string, hrefFor: (id: string, ref: string | null) => string, raw: RawRow): ApprovalItem {
  const amount = raw.amount === null || raw.amount === undefined ? null : Number(raw.amount);
  return {
    id: raw.id,
    category,
    categoryLabel: CATEGORY_LABEL[category] ?? category,
    reference: raw.ref,
    status: raw.status,
    requestedBy: raw.requestedBy,
    amount: Number.isFinite(amount ?? NaN) ? amount : null,
    currency: raw.currency,
    createdAt: raw.createdAt.toISOString(),
    expiresAt: raw.expiresAt ? raw.expiresAt.toISOString() : null,
    href: hrefFor(raw.id, raw.ref),
  };
}

export async function readApprovalCenter(
  scope: ApprovalCenterScope,
  view: ApprovalView,
  deps: Deps = {},
): Promise<ApprovalCenterData> {
  const db = deps.prisma ?? prisma;
  const now = deps.now ?? new Date();
  const base = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const byPerson = view === "myRequests"
    ? { requestedBy: scope.userId }
    : { status: "PENDING", requestedBy: { not: scope.userId }, expiresAt: { gt: now } };
  const degraded: string[] = [];

  const query = async <T>(tag: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch { degraded.push(tag); return null; }
  };

  const [wms, orders, payments, plans, invoices, closes] = await Promise.all([
    query("wms", () => db.wmsApproval.findMany({
      where: { ...base, ...byPerson },
      select: { id: true, aggregateId: true, status: true, requestedBy: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" }, take: 100,
    })),
    query("purchaseOrder", () => db.purchaseOrderApproval.findMany({
      where: { ...base, ...byPerson },
      select: { id: true, purchaseOrderId: true, status: true, requestedBy: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" }, take: 100,
    })),
    query("purchasePayment", () => db.purchasePaymentApproval.findMany({
      where: { ...base, ...byPerson },
      select: { id: true, purchaseOrderId: true, status: true, requestedBy: true, amount: true, currency: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" }, take: 100,
    })),
    query("purchasePlan", () => db.purchasePlanApproval.findMany({
      where: { ...base, ...byPerson },
      select: { id: true, planId: true, status: true, requestedBy: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" }, take: 100,
    })),
    query("purchaseInvoice", () => db.purchaseInvoiceApproval.findMany({
      where: { ...base, ...byPerson },
      select: { id: true, invoiceId: true, status: true, requestedBy: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" }, take: 100,
    })),
    view === "toReview"
      ? Promise.resolve(null)
      : query("financeClose", () => db.financeCloseReview.findMany({
          where: { ...base, requestedBy: scope.userId },
          select: { id: true, bookId: true, status: true, requestedBy: true, createdAt: true },
          orderBy: { createdAt: "desc" }, take: 100,
        })),
  ]);

  const items: ApprovalItem[] = [];
  if (wms) items.push(...wms.map((r) => toItem("wms", (id) => `/operations?view=wms-approvals&approvalId=${id}`, {
    id: r.id, ref: r.aggregateId, status: r.status, requestedBy: r.requestedBy, amount: null, currency: null,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
  })));
  if (orders) items.push(...orders.map((r) => toItem("purchaseOrder", (id) => `/operations?view=purchase-orders&approvalId=${id}`, {
    id: r.id, ref: r.purchaseOrderId, status: r.status, requestedBy: r.requestedBy, amount: null, currency: null,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
  })));
  if (payments) items.push(...payments.map((r) => toItem("purchasePayment", (id) => `/operations?view=purchase-orders&approvalId=${id}`, {
    id: r.id, ref: r.purchaseOrderId, status: r.status, requestedBy: r.requestedBy, amount: r.amount, currency: r.currency,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
  })));
  if (plans) items.push(...plans.map((r) => toItem("purchasePlan", (id) => `/operations?view=purchase-plans&approvalId=${id}`, {
    id: r.id, ref: r.planId, status: r.status, requestedBy: r.requestedBy, amount: null, currency: null,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
  })));
  if (invoices) items.push(...invoices.map((r) => toItem("purchaseInvoice", (id) => `/operations?view=purchase-invoices&approvalId=${id}`, {
    id: r.id, ref: r.invoiceId, status: r.status, requestedBy: r.requestedBy, amount: null, currency: null,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
  })));
  if (closes) items.push(...closes.map((r) => toItem("financeClose", (id) => `/versions?closeReviewId=${id}`, {
    id: r.id, ref: r.bookId, status: r.status, requestedBy: r.requestedBy, amount: null, currency: null,
    createdAt: r.createdAt, expiresAt: null,
  })));

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.category] = (counts[item.category] ?? 0) + 1;

  return { generatedAt: now.toISOString(), view, items, counts, degraded };
}
