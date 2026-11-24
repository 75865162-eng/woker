import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { readHostDataset, type HostQuery, type HostRow } from "../src/lib/sellfox/host-read";
import type { HostDataset } from "../src/lib/sellfox/host-pages";

const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
const query: HostQuery = {
  from: "2026-11-01", to: "2026-11-02", site: "", shop: "", search: "", adType: "",
  page: 1, pageSize: 20, sortBy: "reportDate", sortOrder: "desc",
};
const dataset: HostDataset = {
  id: "fixture-ads", label: "广告测试", status: "live", priority: "P0", table: "SellfoxAdsProductDaily",
  api: [], grain: "按日 × 店铺", reader: "ads_product", columns: [],
};
const metrics = ["impressions", "clicks", "cost", "adOrders", "adSales"] as const;

async function readFixture(rows: HostRow[], groups: HostRow[]) {
  assert.equal(process.env.DATABASE_URL, undefined, "隔离测试不得继承数据库凭据");
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let aggregateArgs: Record<string, unknown> | undefined;
  globals.prisma = {
    sellfoxAdsProductDaily: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.organizationId, scope.organizationId);
        assert.equal(where.workspaceId, scope.workspaceId);
        return rows;
      },
      count: async () => rows.length,
      groupBy: async (args: Record<string, unknown>) => {
        if ((args.by as string[]).includes("storeId")) return rows.length ? [{ storeId: "fixture-store" }] : [];
        aggregateArgs = args;
        return groups;
      },
    },
  } as unknown as PrismaClient;
  try {
    return { result: await readHostDataset(dataset, scope, query), aggregateArgs };
  } finally {
    globals.prisma = previous;
  }
}

function group(currency: string | null, sum: Record<string, number | null>, counts: Record<string, number>, size: number) {
  return { currency, _sum: sum, _count: { _all: size, ...counts } };
}

const zeros = Object.fromEntries(metrics.map(field => [field, 0]));
const ones = Object.fromEntries(metrics.map(field => [field, 1]));

test("广告派生比例保留缺失观测，真实零分子仍为零", async () => {
  const { result } = await readFixture([
    { clicks: null, impressions: 100, cost: null, adSales: 20 },
    { impressions: 100, clicks: 2, cost: 4 },
    { clicks: 0, impressions: 100, cost: 0, adSales: 20 },
    { clicks: 2, impressions: 100, cost: 4, adSales: 20 },
    { clicks: 2, impressions: null, cost: 4, adSales: null },
  ], []);
  assert.deepEqual(result.rows.map(row => [row.ctr, row.cpc, row.acos, row.roas]), [
    [null, null, null, null], [0.02, 2, null, null], [0, null, 0, null], [0.02, 2, 0.2, 5], [null, 2, null, null],
  ]);
});

test("广告空结果的指标合计保持未知", async () => {
  const { result } = await readFixture([], []);
  assert.deepEqual(result.totals, { impressions: null, clicks: null, adOrders: null, byCurrency: [] });
});

test("广告全空和部分缺失的指标不拼造完整合计", async () => {
  const { result } = await readFixture([{}], [
    group("USD", { impressions: 100, clicks: 3, cost: 5, adOrders: null, adSales: 20 },
      { impressions: 2, clicks: 1, cost: 1, adOrders: 0, adSales: 2 }, 2),
    group("EUR", { impressions: 50, clicks: 2, cost: 4, adOrders: 1, adSales: 10 }, ones, 1),
  ]);
  assert.equal(result.totals.impressions, 150);
  assert.equal(result.totals.clicks, null);
  assert.equal(result.totals.adOrders, null);
  assert.deepEqual(result.totals.byCurrency, [
    { currency: "EUR", values: { cost: 4, adSales: 10 } },
    { currency: "USD", values: { cost: null, adSales: 20 } },
  ]);
});

test("广告完整真实零与未知币种保持原值，并查询各指标观测数", async () => {
  const { result, aggregateArgs } = await readFixture([{}], [group(null, zeros, ones, 1)]);
  assert.deepEqual(result.totals, {
    impressions: 0, clicks: 0, adOrders: 0,
    byCurrency: [{ currency: "", values: { cost: 0, adSales: 0 } }],
  });
  assert.deepEqual(aggregateArgs?._count, { _all: true, impressions: true, clicks: true, cost: true, adOrders: true, adSales: true });
});

test("广告缺失聚合观测和全空金额保持未知", async () => {
  const { result } = await readFixture([{}], [group("USD", {}, {}, 1)]);
  assert.deepEqual(result.totals, {
    impressions: null, clicks: null, adOrders: null,
    byCurrency: [{ currency: "USD", values: { cost: null, adSales: null } }],
  });
});

// P4：字段选择 + 精确匹配必须真实下推到 Prisma where，不能是前端假开关。
async function captureWhere(extra: Partial<HostQuery>) {
  assert.equal(process.env.DATABASE_URL, undefined, "隔离测试不得继承数据库凭据");
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let captured: Record<string, unknown> = {};
  globals.prisma = {
    sellfoxAdsProductDaily: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => { captured = where; return []; },
      count: async () => 0,
      groupBy: async () => [],
    },
  } as unknown as PrismaClient;
  try {
    await readHostDataset(dataset, scope, { ...query, ...extra });
    return captured;
  } finally {
    globals.prisma = previous;
  }
}

test("P4 字段选择：限定字段只查白名单内单列", async () => {
  const where = await captureWhere({ search: "B0XXX", searchField: "asin" });
  assert.deepEqual(where.OR, [{ asin: { contains: "B0XXX", mode: "insensitive" } }]);
});

test("P4 精确匹配：相等而非包含", async () => {
  const where = await captureWhere({ search: "B0XXX", exactMatch: true });
  const or = where.OR as Record<string, Record<string, unknown>>[];
  assert.ok(Array.isArray(or) && or.length === 5);
  for (const clause of or) {
    const condition = Object.values(clause)[0];
    assert.deepEqual(condition, { equals: "B0XXX", mode: "insensitive" });
  }
});

test("P4 非法字段：忽略并退回全字段，杜绝字段注入", async () => {
  const where = await captureWhere({ search: "x", searchField: "asin; DROP TABLE" });
  const or = where.OR as Record<string, unknown>[];
  assert.equal(or.length, 5, "非法字段不参与，退回全部 5 个白名单字段");
});
