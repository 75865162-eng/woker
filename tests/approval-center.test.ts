import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readApprovalCenter, type ApprovalCenterScope } from "@/lib/approvals/center-read";

const scope: ApprovalCenterScope = { organizationId: "o1", workspaceId: "w1", userId: "me" };
const NOW = new Date("2026-11-21T00:00:00Z");

function dbWith(captured: { wmsWhere?: unknown }) {
  const empty = { findMany: async () => [] };
  return {
    wmsApproval: { findMany: async (args: { where: unknown }) => { captured.wmsWhere = args.where; return []; } },
    purchaseOrderApproval: empty,
    purchasePaymentApproval: empty,
    purchasePlanApproval: empty,
    purchaseInvoiceApproval: empty,
    financeCloseReview: empty,
  } as never;
}

test("toReview: 待我审批=PENDING且非本人发起且未过期", async () => {
  const captured: { wmsWhere?: unknown } = {};
  await readApprovalCenter(scope, "toReview", { prisma: dbWith(captured), now: NOW });
  const where = captured.wmsWhere as Record<string, unknown>;
  assert.equal(where.organizationId, "o1");
  assert.equal(where.workspaceId, "w1");
  assert.equal(where.status, "PENDING");
  assert.deepEqual(where.requestedBy, { not: "me" });
  assert.ok(where.expiresAt);
});

test("myRequests: 我发起的=requestedBy本人;含财务关账复核", async () => {
  const captured: { wmsWhere?: unknown } = {};
  await readApprovalCenter(scope, "myRequests", { prisma: dbWith(captured), now: NOW });
  const where = captured.wmsWhere as Record<string, unknown>;
  assert.equal(where.requestedBy, "me");
  assert.equal(where.status, undefined, "我发起的不应按状态过滤");
});

test("聚合结果:分类计数/按时间倒序/跳转链接/金额缺失留null", async () => {
  const db = {
    wmsApproval: { findMany: async () => [
      { id: "w1", aggregateId: "agg-1", status: "PENDING", requestedBy: "other", createdAt: new Date("2026-11-20"), expiresAt: new Date("2026-11-25") },
    ] },
    purchaseOrderApproval: { findMany: async () => [] },
    purchasePaymentApproval: { findMany: async () => [
      { id: "p1", purchaseOrderId: "PO-1", status: "PENDING", requestedBy: "other", amount: 1234.5, currency: "USD", createdAt: new Date("2026-11-21"), expiresAt: new Date("2026-11-28") },
    ] },
    purchasePlanApproval: { findMany: async () => [] },
    purchaseInvoiceApproval: { findMany: async () => [] },
    financeCloseReview: { findMany: async () => [] },
  } as never;
  const data = await readApprovalCenter(scope, "toReview", { prisma: db, now: NOW });
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].id, "p1", "按创建时间倒序");
  assert.equal(data.items[0].amount, 1234.5);
  assert.equal(data.items[0].currency, "USD");
  assert.equal(data.items[1].amount, null, "缺金额留null不补零");
  assert.match(data.items[1].href, /approvalId=w1/);
  assert.equal(data.counts.wms, 1);
  assert.equal(data.counts.purchasePayment, 1);
  assert.deepEqual(data.degraded, []);
});

test("单项查询失败只降级该类为空,不影响整页", async () => {
  const db = {
    wmsApproval: { findMany: async () => { throw new Error("db down"); } },
    purchaseOrderApproval: { findMany: async () => [] },
    purchasePaymentApproval: { findMany: async () => [] },
    purchasePlanApproval: { findMany: async () => [] },
    purchaseInvoiceApproval: { findMany: async () => [] },
    financeCloseReview: { findMany: async () => [] },
  } as never;
  const data = await readApprovalCenter(scope, "toReview", { prisma: db, now: NOW });
  assert.ok(data.degraded.includes("wms"));
  assert.equal(data.items.length, 0);
});

test("source guard: 只读聚合,审批动作走现有端点不绕守卫", () => {
  const reader = readFileSync(new URL("../src/lib/approvals/center-read.ts", import.meta.url), "utf8");
  assert.doesNotMatch(reader, /decideApproval|decidePurchaseOrderApproval|\.update\(|\$transaction/);
  const route = readFileSync(new URL("../src/app/api/approvals/center/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireApiPermission\("operations", "view"/);
  const nav = readFileSync(new URL("../src/components/app-shell/business-navigation.ts", import.meta.url), "utf8");
  assert.match(nav, /href: "\/purchase\/approvals", label: "审批中心"/);
});
