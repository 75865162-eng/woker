import assert from "node:assert/strict";
import test from "node:test";
import { createProductListSummaryContribution, refreshProductListSummaryBundle } from "@/lib/products/product-list-summary";
import { createProductListScopeKey, getCachedProductListSummary, setCachedProductListSummary, updateCachedProductListSummariesForProductChange, invalidateProductListSummaryCaches } from "@/lib/products/product-list-cache";

test("all与dashboard真实缓存共用贡献计算且空集计数为零", () => {
  const scope = { organizationId: "summary-fixture", workspaceId: "workspace" };
  const empty = createProductListSummaryContribution(null);
  assert.ok(Object.values(empty).every(value => value === 0));
  try {
    for (const source of ["all", "dashboard"] as const) setCachedProductListSummary(createProductListScopeKey({ ...scope, source }), empty);
    updateCachedProductListSummariesForProductChange({ ...scope, after: { status: "developing" } });
    for (const source of ["all", "dashboard"] as const) {
      const summary = getCachedProductListSummary(createProductListScopeKey({ ...scope, source }));
      assert.equal(summary?.total, 1);
      assert.equal(summary?.developing, 1);
    }
    updateCachedProductListSummariesForProductChange({ ...scope, before: { status: "developing" } });
    for (const source of ["all", "dashboard"] as const) assert.deepEqual(getCachedProductListSummary(createProductListScopeKey({ ...scope, source })), empty);
  } finally { invalidateProductListSummaryCaches("summary-fixture:workspace:"); }
});

test("重建汇总直接映射查询字段并保留两类来源的独立计数", async () => {
  const globalClient = globalThis as unknown as { prisma?: unknown };
  const original = globalClient.prisma;
  const writes: Array<{ create: Record<string, unknown> }> = [];
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{
      allTotal: 12n, allDeveloping: 3n, allOpsReview: 4n, allDesignInProgress: 5n, allOperationsProgress: 6n, allOverdue: 7n,
      dashboardTotal: 8n, dashboardDeveloping: 1n, dashboardOpsReview: 2n, dashboardDesignInProgress: 3n, dashboardOperationsProgress: 4n, dashboardOverdue: 5n,
    }],
    productListSummaryRecord: { upsert: async (input: { create: Record<string, unknown> }) => { writes.push(input); } },
  };
  globalClient.prisma = { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) };
  try {
    const bundle = await refreshProductListSummaryBundle({ organizationId: "summary-fixture", workspaceId: "workspace" });
    assert.deepEqual(bundle, {
      all: { total: 12, developing: 3, opsReview: 4, designInProgress: 5, operationsProgress: 6, overdue: 7 },
      dashboard: { total: 8, developing: 1, opsReview: 2, designInProgress: 3, operationsProgress: 4, overdue: 5 },
    });
    assert.deepEqual(writes.map(({ create }) => create), [
      { organizationId: "summary-fixture", workspaceId: "workspace", source: "all", ...bundle.all },
      { organizationId: "summary-fixture", workspaceId: "workspace", source: "dashboard", ...bundle.dashboard },
    ]);
  } finally {
    if (original === undefined) Reflect.deleteProperty(globalClient, "prisma");
    else globalClient.prisma = original;
  }
});

test("operations progress card counts incomplete progress instead of the listing-confirming status", () => {
  assert.equal(
    createProductListSummaryContribution({
      status: "listing_confirming",
      operationsProgressIncomplete: false,
    }).operationsProgress,
    0,
  );
  assert.equal(
    createProductListSummaryContribution({
      status: "developing",
      operationsProgressIncomplete: true,
    }).operationsProgress,
    1,
  );
});

test("summary overdue excludes terminal products and uses workflow due time", () => {
  const now = new Date("2026-09-14T00:00:00.000Z");

  assert.equal(
    createProductListSummaryContribution({
      status: "ops_review",
      workflowDueAt: "2026-09-13T23:59:59.000Z",
    }, now).overdue,
    1,
  );
  assert.equal(
    createProductListSummaryContribution({
      status: "listed",
      workflowDueAt: "2026-09-13T23:59:59.000Z",
    }, now).overdue,
    0,
  );
});
