import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { readHostDataset, type HostQuery } from "../src/lib/sellfox/host-read";
import type { HostDataset } from "../src/lib/sellfox/host-pages";

const scope = { organizationId: "fixture-org", workspaceId: "fixture-ws", userId: "fixture-user" };
const query: HostQuery = {
  from: "", to: "", site: "", shop: "", search: "", adType: "",
  page: 1, pageSize: 20, sortBy: "syncedAt", sortOrder: "desc",
};
const dataset: HostDataset = {
  id: "po", label: "采购单", status: "live", priority: "P1", table: "SellfoxApiRecord",
  rawCode: "purchase-order", api: [], grain: "原始行",
  columns: [{ key: "purchaseNo", label: "规划列" }],
};

function withMockPrisma(fn: () => Promise<unknown>) {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let sqlSeen = "";
  globals.prisma = {
    organizationMember: { findUnique: async () => ({ role: "owner" }) },
    sellfoxApiEndpoint: { findUnique: async () => ({ scopeMode: "global" }) },
    sellfoxStore: { findMany: async () => [] },
    $queryRaw: (first: { strings?: string[] } | string[] | string) => {
      const parts = typeof first === "string" ? [first] : Array.isArray(first) ? first : (first?.strings ?? []);
      sqlSeen = parts.join("");
      if (/count\(\*\)/i.test(sqlSeen)) return Promise.resolve([{ total: 2n }]);
      return Promise.resolve([
        { payload: { id: "1", purchaseNo: "PO-1", supplierName: "供应商甲", amount: "100.00", currency: "CNY", createdTime: "2026-11-01" }, syncedAt: new Date("2026-11-02"), storeId: null },
        { payload: { id: "2", purchaseNo: "PO-2", supplierName: "供应商乙", amount: "88.91", currency: "CNY", createdTime: "2026-11-01" }, syncedAt: new Date("2026-11-02"), storeId: null },
      ]);
    },
  } as unknown as PrismaClient;
  return fn().finally(() => { globals.prisma = previous; });
}

test("原始行读取：列由真实 payload 键派生，不套用规划列", async () => {
  await withMockPrisma(async () => {
    const result = await readHostDataset(dataset, scope, query);
    assert.equal(result.total, 2);
    assert.equal(result.rows.length, 2);
    assert.ok(result.columns && result.columns.length > 0, "必须返回动态列");
    const keys = result.columns.map((column) => column.key);
    assert.ok(keys.includes("purchaseNo"));
    assert.ok(keys.includes("supplierName"));
    assert.ok(!keys.includes("规划列不存在"), "不得臆造字段");
    // 规划列里的 purchaseNo 标签被真实键覆盖，展示真实字段名映射
    const purchaseNoColumn = result.columns.find((column) => column.key === "purchaseNo");
    assert.equal(purchaseNoColumn?.label, "采购单号");
  });
});

test("原始行读取：金额键识别为 money，标识键优先排序", async () => {
  await withMockPrisma(async () => {
    const result = await readHostDataset(dataset, scope, query);
    const amountColumn = result.columns?.find((column) => column.key === "amount");
    assert.equal(amountColumn?.kind, "money");
    const keys = result.columns?.map((column) => column.key) ?? [];
    assert.ok(keys.indexOf("purchaseNo") < keys.indexOf("createdTime"), "身份列应排在时间列前");
  });
});
