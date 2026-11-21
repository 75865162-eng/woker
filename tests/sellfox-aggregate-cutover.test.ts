import test from "node:test";
import assert from "node:assert/strict";
import {
  publishAggregateVerdict, readAggregateVerdict, aggregateVerdictKey,
  parseVerdict, setAggregateVerdictRedisForTest, AGG_VERDICT_TTL_SECONDS,
} from "@/lib/sellfox/aggregate-read-state";
import { resolveAggregateCutover } from "@/lib/sellfox/aggregate-read-gate";
import { readSalesSummary } from "@/lib/sellfox/sales-summary";

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string, _mode: string, _ttl: number) => { store.set(k, v); return "OK"; },
    on: () => {},
  };
}

test("verdict key 带 org/ws/domain 隔离；TTL 为 7 天", () => {
  assert.equal(aggregateVerdictKey("o1", "w1", "sales"), "sellfox:agg-verdict:o1:w1:sales");
  assert.equal(AGG_VERDICT_TTL_SECONDS, 7 * 24 * 3600);
});

test("verdict 发布/读取往返 + 解析容错 + fail-open", async () => {
  const r = fakeRedis();
  const verdict = { ok: true, at: "2026-11-21T00:00:00Z", sourceRows: 10, aggregateRows: 10 };
  assert.equal(await publishAggregateVerdict("o1", "w1", "sales", verdict, { redis: r }), true);
  assert.deepEqual(await readAggregateVerdict("o1", "w1", "sales", { redis: r }), verdict);
  // 跨域读不到（隔离）
  assert.equal(await readAggregateVerdict("o1", "w1", "profit", { redis: r }), null);
  // 解析容错
  assert.equal(parseVerdict("not-json"), null);
  assert.equal(parseVerdict('{"ok":"yes"}'), null);
  // Redis 不可用 → fail-open（null）
  assert.equal(await readAggregateVerdict("o1", "w1", "sales", { redis: null }), null);
  setAggregateVerdictRedisForTest(undefined);
});

test("resolveAggregateCutover: 三要素缺一即走 live", () => {
  assert.deepEqual(resolveAggregateCutover({ switchEnabled: false, verdictOk: true, aggregateHasRows: true }), { useAggregate: false, reason: "disabled" });
  assert.deepEqual(resolveAggregateCutover({ switchEnabled: true, verdictOk: false, aggregateHasRows: true }), { useAggregate: false, reason: "not-reconciled" });
  assert.deepEqual(resolveAggregateCutover({ switchEnabled: true, verdictOk: true, aggregateHasRows: false }), { useAggregate: false, reason: "aggregate-empty" });
  assert.deepEqual(resolveAggregateCutover({ switchEnabled: true, verdictOk: true, aggregateHasRows: true }), { useAggregate: true, reason: "ok" });
});

// 注入 prisma-like：按调用顺序返回 probe/statement 结果。
function fakeDb(opts: { aggregateRows: number; sourceRows: number; aggregateThrows?: boolean }) {
  const calls: string[] = [];
  const db = {
    $queryRaw: async (...args: unknown[]) => {
      const sql = args.map((a) => {
        if (a && typeof a === "object" && "strings" in a) return (a as { strings: string[] }).strings.join(" ");
        return typeof a === "string" ? a : "";
      }).join(" ");
      calls.push(sql);
      if (sql.includes("AS n")) return [{ n: BigInt(opts.aggregateRows) }];
      if (sql.includes("SellfoxSalesAggDaily")) {
        if (opts.aggregateThrows) throw new Error("agg down");
        return [{ reportDate: "2026-11-20", quantity: 5n, orders: 2n, revenue: "100.0000", currency: "USD" }];
      }
      return [{ reportDate: "2026-11-20", quantity: 7n, orders: 3n, revenue: "150.0000", currency: "USD" }];
    },
  } as unknown as import("@prisma/client").PrismaClient;
  return { db, calls };
}

test("readSalesSummary: 默认（开关关/无verdict）走 live，字段稳定", async () => {
  const { db } = fakeDb({ aggregateRows: 10, sourceRows: 10 });
  const out = await readSalesSummary({ organizationId: "o", workspaceId: "w" }, "2026-11-01", "2026-11-30", {
    prisma: db, switchEnabled: false, verdictOk: false,
  });
  assert.equal(out.source, "live");
  assert.equal(out.points[0].quantity, 7);
  assert.equal(out.points[0].revenue, "150.0000");
  assert.equal(out.coverage.rows, 1);
});

test("readSalesSummary: 三要素齐备走聚合", async () => {
  const { db } = fakeDb({ aggregateRows: 10, sourceRows: 10 });
  const out = await readSalesSummary({ organizationId: "o", workspaceId: "w" }, "2026-11-01", "2026-11-30", {
    prisma: db, switchEnabled: true, verdictOk: true,
  });
  assert.equal(out.source, "aggregate");
  assert.equal(out.points[0].quantity, 5);
});

test("readSalesSummary: 聚合无数据 / 读取异常都回退 live（不出空页）", async () => {
  const empty = fakeDb({ aggregateRows: 0, sourceRows: 10 });
  const out1 = await readSalesSummary({ organizationId: "o", workspaceId: "w" }, "a", "b", { prisma: empty.db, switchEnabled: true, verdictOk: true });
  assert.equal(out1.source, "live");

  const throwing = fakeDb({ aggregateRows: 10, sourceRows: 10, aggregateThrows: true });
  const out2 = await readSalesSummary({ organizationId: "o", workspaceId: "w" }, "a", "b", { prisma: throwing.db, switchEnabled: true, verdictOk: true });
  assert.equal(out2.source, "live");
  assert.equal(out2.points.length, 1);
});
