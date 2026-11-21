import test from "node:test";
import assert from "node:assert/strict";
import { readDashboard, type DashboardScope } from "@/lib/sellfox/dashboard-read";
import { readFileSync } from "node:fs";

const scope: DashboardScope = { organizationId: "o1", workspaceId: "w1", userId: "u1" };
const NOW = new Date("2026-11-21T00:00:00Z");

function fakePrisma() {
  return {
    // profit/ads KPI 用数据库端 SUM（非 findMany 拉全明细到 JS reduce），语义等价。
    sellfoxProfitAggDaily: { aggregate: async () => ({ _sum: { netRevenue: 0n }, _count: { id: 0 } }), findFirst: async () => null },
    sellfoxAdsAggDaily: { aggregate: async () => ({ _sum: { cost: 0n }, _count: { id: 0 } }), findFirst: async () => null },
    // 库存 KPI/coverage 读当前态预聚合表（非 108 万行原始快照表），保持与生产一致。
    sellfoxInventoryAgg: { aggregate: async () => ({ _sum: { quantity: 5n, inTransit: 2n } }), count: async () => 0 },
    sellfoxStore: { count: async () => 0 },
    sellfoxSalesDailySnapshot: { count: async () => 0 },
    sellfoxSyncRun: { findFirst: async () => null },
    $queryRaw: async () => [],
  } as never;
}

const fullSales = {
  source: "live" as const,
  points: [
    { reportDate: "2026-11-20", quantity: 3, orders: 2, revenue: "100.50", currency: "USD" },
    { reportDate: "2026-11-21", quantity: 5, orders: 4, revenue: "200.25", currency: "USD" },
  ],
  coverage: { rows: 2, earliest: "2026-11-20", latest: "2026-11-21" },
};

test("readDashboard: 管理员(undefined) 走完整销售汇总,KPI汇总同币种,含个人待办", async () => {
  const data = await readDashboard(scope, undefined, {
    prisma: fakePrisma(), now: NOW,
    readSalesSummary: (async () => fullSales) as never,
    loadPending: (async () => [{ id: "1" }, { id: "2" }]) as never,
  });
  assert.equal(data.kpis.find((k) => k.key === "quantity")?.value, 8);
  assert.equal(data.kpis.find((k) => k.key === "orders")?.value, 6);
  const revenue = data.kpis.find((k) => k.key === "revenue");
  assert.equal(revenue?.value, 300.75);
  assert.equal(revenue?.currency, "USD");
  assert.equal(data.pendingCount, 2);
  assert.deepEqual(data.degraded, []);
});

test("readDashboard: 空集([]) 强制 scoped 销售为空,不串全量,也不调用完整 reader", async () => {
  let fullReaderCalled = false;
  const data = await readDashboard(scope, [], {
    prisma: fakePrisma(), now: NOW,
    readSalesSummary: (async () => { fullReaderCalled = true; return fullSales; }) as never,
    loadPending: (async () => []) as never,
  });
  assert.equal(fullReaderCalled, false, "空集用户绝不能触发全量销售 reader");
  assert.equal(data.kpis.find((k) => k.key === "quantity")?.value, 0);
  assert.equal(data.kpis.find((k) => k.key === "revenue")?.value, null);
});

test("readDashboard: 多币种销售额留 MULTI 不强行相加;单项读取失败只降级对应卡片", async () => {
  const multi = {
    source: "live" as const,
    points: [
      { reportDate: "2026-11-20", quantity: 1, orders: 1, revenue: "10", currency: "USD" },
      { reportDate: "2026-11-21", quantity: 1, orders: 1, revenue: "70", currency: "EUR" },
    ],
    coverage: { rows: 2, earliest: "2026-11-20", latest: "2026-11-21" },
  };
  const data = await readDashboard(scope, undefined, {
    prisma: fakePrisma(), now: NOW,
    readSalesSummary: (async () => multi) as never,
    loadPending: (async () => { throw new Error("boom"); }) as never,
  });
  const revenue = data.kpis.find((k) => k.key === "revenue");
  assert.equal(revenue?.value, null);
  assert.equal(revenue?.currency, "MULTI");
  assert.equal(data.pendingCount, 0);
  assert.ok(data.degraded.includes("pending"));
});

test("source guard: 看板API鉴权+三态收窄,首页kpis插槽接入,不臆造数据", () => {
  const route = readFileSync(new URL("../src/app/api/dashboard/route.ts", import.meta.url), "utf8");
  assert.match(route, /getCurrentUserFromRequest/);
  assert.match(route, /resolveSellfoxVisibleStoreIds/);
  assert.doesNotMatch(route, /requireApiPermission\("sellfox"/);
  const home = readFileSync(new URL("../src/app/(erp)/page.tsx", import.meta.url), "utf8");
  assert.match(home, /kpis=\{<DashboardOverview/);
});
