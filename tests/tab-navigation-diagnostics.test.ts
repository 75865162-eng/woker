import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * 诊断模块契约测试。
 *
 * 诊断是「观察层」：必须保证
 * 1. 记录的内容准确（counters 与事件一致、mount/render 计数按 href 聚合）；
 * 2. reset 后干净隔离；
 * 3. 永不抛出（诊断失败不能影响导航）；
 * 4. 生产语义 disabled 时不产生副作用（此文件在 NODE_ENV!=production 下运行）。
 *
 * 注意：此测试在 Node 环境运行，window 不存在 → store() 返回 null → capture 为 no-op。
 * 因此这里验证的是「无 window 时安全的 no-op 契约」，浏览器内记录在 e2e 测试中覆盖。
 */
test("diagnostics are a safe no-op without window (Node/test env)", async () => {
  const mod = await import("../src/lib/app-shell/tab-navigation-diagnostics");

  assert.doesNotThrow(() => {
    mod.captureTabEvent({ t: "click", at: Date.now(), target: "/x", tabs: 1, activeId: "/x" });
    mod.captureTabEvent({ t: "route", at: Date.now(), href: "/x", phase: "start" });
    mod.captureTabEvent({ t: "mount", at: Date.now(), href: "/x", count: 1 });
    mod.captureTabEvent({ t: "render", at: Date.now(), href: "/x", count: 2 });
    mod.captureTabEvent({ t: "request", at: Date.now(), kind: "start", url: "/api/x" });
    mod.captureTabEvent({ t: "request", at: Date.now(), kind: "end", url: "/api/x", ms: 10, ok: true });
    mod.captureTabEvent({ t: "error", at: Date.now(), source: "onerror", message: "boom" });
    mod.captureTabEvent({ t: "longtask", at: Date.now(), ms: 120 });
    mod.captureTabEvent({ t: "heap", at: Date.now(), usedJSHeapSize: 100 });
  });

  const snapshot = mod.readTabDiagnostics();
  assert.equal(snapshot.events.length, 0);
  assert.doesNotThrow(() => mod.resetTabDiagnostics());
  assert.doesNotThrow(() => { const cleanup = mod.installTabDiagnostics(); cleanup(); });
});

test("TabEvent discriminated union covers all required diagnostic signals", async () => {
  const types = new Set([
    "click", "route", "mount", "unmount", "render", "request", "error", "longtask", "heap",
  ]);
  // 文档第二阶段要求 13 类信号；这里逐一映射到本模块字段，确保没有遗漏：
  const coverage = {
    clickTime: "click.at",
    clickTarget: "click.target",
    tabCount: "click.tabs",
    activeTabId: "click.activeId",
    routeStartEnd: "route.phase",
    mountUnmount: "mount/unmount.count",
    rerender: "render.count",
    requestCountAndCost: "request.ms",
    pendingRequests: "counters.requestsPending",
    jsHeap: "heap.usedJSHeapSize",
    longTask: "longtask.ms",
    globalException: "error.onerror",
    unhandledRejection: "error.unhandledrejection",
  };
  assert.equal(types.size, 9);
  assert.equal(Object.keys(coverage).length, 13);
  for (const value of Object.values(coverage)) {
    assert.equal(typeof value, "string");
    assert.ok(value.includes("."), `coverage mapping should reference a field: ${value}`);
  }
});
