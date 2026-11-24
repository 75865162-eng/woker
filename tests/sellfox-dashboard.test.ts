import test from "node:test";
import assert from "node:assert/strict";
import { readDashboard, type DashboardScope } from "@/lib/sellfox/dashboard-read";
import { readFileSync } from "node:fs";

const scope: DashboardScope = { organizationId: "o1", workspaceId: "w1", userId: "u1" };
const NOW = new Date("2026-11-21T00:00:00Z");

function fakePrisma(queryRaw?: () => Promise<unknown[]>) {
  return {
    // profit/ads KPI 用数据库端 SUM（非 findMany 拉全明细到 JS reduce），语义等价。
    sellfoxProfitAggDaily: { aggregate: async () => ({ _sum: { netRevenue: 0n }, _count: { id: 0 } }), findFirst: async () => null },
    sellfoxAdsAggDaily: { aggregate: async () => ({ _sum: { cost: 0n }, _count: { id: 0 } }), findFirst: async () => null },
    // 库存 KPI/coverage 读当前态预聚合表（非 108 万行原始快照表），保持与生产一致。
    sellfoxInventoryAgg: { aggregate: async () => ({ _sum: { quantity: 5n, inTransit: 2n } }), count: async () => 0 },
    sellfoxStore: { count: async () => 0 },
    sellfoxSalesDailySnapshot: { count: async () => 0 },
    sellfoxSyncRun: { findFirst: async () => null },
    $queryRaw: queryRaw ?? (async () => []),
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

test("readDashboard: 排行榜个别金额NULL不抹掉整店销售额,SQL对有效值求和", async () => {
  // 模拟生产 NV店-US 情形：1458 行里 2 行 revenueOriginal 为 NULL。
  // 修复后 SQL 用 count(x)>0 判定，只要存在有效金额就返回 SUM(有效值)。
  const db = fakePrisma(async () => [
    { storeId: "nv-us", storeName: "NV店-US", revenue: "82966.07", quantity: 3956n },
    { storeId: "all-null", storeName: "全空店", revenue: null, quantity: 12n },
  ]);
  const data = await readDashboard(scope, undefined, {
    prisma: db, now: NOW,
    readSalesSummary: (async () => fullSales) as never,
    loadPending: (async () => []) as never,
  });
  const nv = data.ranking.find((r) => r.storeId === "nv-us");
  assert.equal(nv?.quantity, 3956);
  assert.equal(nv?.revenue, 82966.07, "部分行金额缺失时，整店销售额应对有效值求和而非留空");
  const allNull = data.ranking.find((r) => r.storeId === "all-null");
  assert.equal(allNull?.revenue, null, "整店金额全缺失仍留空，不臆造");
});

test("source guard: 排行榜SQL不用 count=count 全有或全无(防NV店销售额被抹空)", () => {
  const src = readFileSync(new URL("../src/lib/sellfox/dashboard-read.ts", import.meta.url), "utf8");
  const rankingSql = src.slice(src.indexOf("async function readRanking"), src.indexOf("type CoverageBase"));
  assert.match(rankingSql, /count\(a\."revenueOriginal"\)>0/, "排行榜须对有效金额求和");
  assert.doesNotMatch(rankingSql, /count\(a\."revenueOriginal"\)=count\(\*\)/, "不得用全有或全无抹掉整店销售额");
  // 聚合写入层的 NULL-preserving 语义保持不变，确保与对账一致。
  const aggRefresh = readFileSync(new URL("../src/lib/sellfox/agg-refresh.ts", import.meta.url), "utf8");
  assert.match(aggRefresh, /count\(t\."revenue"\)=count\(\*\)/, "聚合写入层对账语义不得改动");
});

test("source guard: 看板API鉴权+三态收窄,首页kpis插槽接入,不臆造数据", () => {
  const route = readFileSync(new URL("../src/app/api/dashboard/route.ts", import.meta.url), "utf8");
  assert.match(route, /getCurrentUserFromRequest/);
  assert.match(route, /resolveSellfoxVisibleStoreIds/);
  assert.doesNotMatch(route, /requireApiPermission\("sellfox"/);
  const home = readFileSync(new URL("../src/app/(erp)/page.tsx", import.meta.url), "utf8");
  assert.match(home, /kpis=\{<DashboardOverview/);
});
