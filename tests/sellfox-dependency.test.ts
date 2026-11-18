import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { asJsonObject, markRunWaitingDependency, sellfoxStoresReady, WAITING_DEPENDENCY } from "@/lib/sellfox/sync-dependency";
import { buildSellfoxFullSyncPlan } from "@/lib/sellfox/sync-orchestrator";
import { builtinSyncRules } from "@/lib/sellfox/sync-rules";
import { runStore } from "./helpers/sellfox-run-store";

test("零店铺等待状态是字符串常量，依赖表里 stores 无前置且其余全部依赖 stores", () => {
  assert.equal(WAITING_DEPENDENCY, "waiting_dependency");
  const stores = builtinSyncRules.find((rule) => rule.id === "stores");
  assert.ok(stores);
  assert.deepEqual(stores.dependsOn, []);
  const downstream = builtinSyncRules.filter((rule) => rule.id !== "stores");
  assert.ok(downstream.length > 0);
  assert.ok(downstream.every((rule) => rule.dependsOn.includes("stores")));
});

test("全量计划以 stores 为首个资源，order 保持依赖拓扑顺序", () => {
  const plan = buildSellfoxFullSyncPlan({ from: "2026-11-01", to: "2026-11-02", today: "2026-11-03" });
  assert.equal(plan[0].resource, "stores");
  const firstSeen = new Map<string, number>();
  plan.forEach((item, index) => { if (!firstSeen.has(item.resource)) firstSeen.set(item.resource, index); });
  const storesPos = firstSeen.get("stores")!;
  for (const [resource, pos] of firstSeen) {
    if (resource === "stores") continue;
    assert.ok(pos > storesPos, `${resource} 必须排在 stores 之后`);
  }
});

test("缺店铺的 run 被标记为 waiting_dependency 且释放租约、不写失败错误", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let run: Record<string, unknown> = {
    id: "run-wait", status: "running", executionToken: "tok", leaseExpiresAt: new Date(Date.now() + 60_000),
    summary: { trigger: "auto_full", startDate: "2026-11-01", endDate: "2026-11-02" },
    error: null, finishedAt: null,
  };
  globals.prisma = { sellfoxSyncRun: runStore(() => run, (value) => { run = value; }) } as unknown as PrismaClient;
  try {
    await markRunWaitingDependency({ runId: "run-wait", token: "tok" }, "run-wait", "等待店铺主数据（stores）同步完成。");
    assert.equal(run.status, WAITING_DEPENDENCY);
    assert.equal(run.error, null);
    assert.equal(run.executionToken, null);
    assert.equal(run.leaseExpiresAt, null);
    assert.ok(run.finishedAt);
    const summary = run.summary as Record<string, unknown>;
    assert.equal(summary.dependencyReason, "等待店铺主数据（stores）同步完成。");
    assert.equal(summary.dependencyResource, "stores");
    assert.equal(summary.startDate, "2026-11-01", "冻结窗口必须保留以便唤醒后重跑");
  } finally {
    globals.prisma = previous;
  }
});

test("sellfoxStoresReady 以店铺表真实 count 判定，空工作区返回 false", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  let count = 0;
  globals.prisma = {
    sellfoxStore: { count: async () => count },
  } as unknown as PrismaClient;
  try {
    assert.equal(await sellfoxStoresReady({ organizationId: "org", workspaceId: "ws" }), false);
    count = 1;
    assert.equal(await sellfoxStoresReady({ organizationId: "org", workspaceId: "ws" }), true);
  } finally {
    globals.prisma = previous;
  }
});

test("asJsonObject 只接受普通对象，null/数组/原始值返回空对象", () => {
  assert.deepEqual(asJsonObject(null), {});
  assert.deepEqual(asJsonObject([]), {});
  assert.deepEqual(asJsonObject("x"), {});
  assert.deepEqual(asJsonObject({ a: 1 }), { a: 1 });
});
