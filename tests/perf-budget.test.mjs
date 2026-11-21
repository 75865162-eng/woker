import test from "node:test";
import assert from "node:assert/strict";
import { judgePage, judgeAll } from "../scripts/performance/perf-budget.mjs";
import { PERF_ROUTES, PERF_BUDGET, CORE_ROUTES, FIXTURE_MODULES, collectableTopDirs } from "../scripts/performance/perf-routes.mjs";

test("档位判定: A/B 档 1500ms 线, C 档 3000ms 线, 边界等号 PASS", () => {
  const b = { path: "/product", tier: "B" };
  assert.equal(judgePage(b, { totalMs: 1499 }).pass, true);
  assert.equal(judgePage(b, { totalMs: 1500 }).pass, true, "恰好等于阈值应 PASS");
  assert.equal(judgePage(b, { totalMs: 1500.01 }).pass, false);
  const c = { path: "/sellfox/sales", tier: "C" };
  assert.equal(judgePage(c, { totalMs: 2000 }).pass, true, "C 档 2000ms 未超 3000ms 线");
  assert.equal(judgePage(c, { totalMs: 3100 }).pass, false);
});

test("判定: 无数据/非数值记 NO_DATA 且 FAIL, 不伪造数值", () => {
  const r = judgePage({ path: "/x", tier: "B" }, undefined);
  assert.equal(r.pass, false);
  assert.equal(r.status, "NO_DATA");
  assert.equal(r.value, null);
  assert.equal(judgePage({ path: "/x", tier: "B" }, { totalMs: NaN }).status, "NO_DATA");
});

test("judgeAll: 逐页对齐, 缺采页计入 FAIL, pass 需全绿", () => {
  const result = {
    coldPages: [
      { path: "/product", totalMs: 500 },
      { path: "/sellfox/sales", totalMs: 9000 }, // C 档超线
    ],
  };
  const verdict = judgeAll(result, [
    { path: "/product", tier: "B" },
    { path: "/sellfox/sales", tier: "C" },
    { path: "/tasks", tier: "A" }, // 缺采
  ]);
  assert.equal(verdict.total, 3);
  assert.equal(verdict.passCount, 1);
  assert.equal(verdict.failCount, 2);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.fail.find(f => f.path === "/sellfox/sales").status, "FAIL");
  assert.equal(verdict.fail.find(f => f.path === "/tasks").status, "NO_DATA");
});

test("judgeAll: 全部达标则 pass=true (C 档页用 C 线不误判)", () => {
  const result = { coldPages: PERF_ROUTES.map(r => ({ path: r.path, totalMs: 100 })) };
  const verdict = judgeAll(result);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.failCount, 0);
  assert.equal(verdict.total, PERF_ROUTES.length);
});

test("路由清单完整性: 无动态 slug/redirect 壳, heading 非空, 档位合法, CORE 均在 PERF 内", () => {
  assert.ok(PERF_ROUTES.length >= 55, `可采集页过少: ${PERF_ROUTES.length}`);
  const paths = PERF_ROUTES.map(r => r.path);
  assert.equal(new Set(paths).size, paths.length, "路由重复");
  for (const r of PERF_ROUTES) {
    assert.ok(r.heading && r.heading.length > 0, `${r.path} 缺 heading`);
    assert.ok(["A", "B", "C", "D"].includes(r.tier), `${r.path} 档位非法`);
    assert.ok(!/\[|\]/.test(r.path), `${r.path} 是动态 slug 页,不应纳入`);
  }
  for (const forbidden of ["/ai", "/amz", "/purchase", "/image-upscale", "/forbidden", "/design"]) {
    assert.ok(!paths.includes(forbidden), `${forbidden} 是壳/redirect,不应纳入`);
  }
  for (const core of CORE_ROUTES) assert.ok(paths.includes(core.path), `CORE ${core.path} 不在 PERF 清单`);
  assert.ok(["A", "B", "C", "D"].every(t => PERF_BUDGET[t]?.coldLineMs > 0), "档位阈值不全");
});

test("fixture 权限模块覆盖所有需授权页; collectableTopDirs 含 sellfox/operations 等", () => {
  const modules = new Set(FIXTURE_MODULES);
  for (const r of PERF_ROUTES) if (r.module) assert.ok(modules.has(r.module), `${r.path} 需模块 ${r.module} 未授予 fixture`);
  const dirs = collectableTopDirs();
  for (const d of ["sellfox", "operations", "agents", "logistics", "product", "amazon"]) {
    assert.ok(dirs.includes(d), `保留目录缺 ${d}`);
  }
  assert.ok(dirs.includes("forbidden"), "权限测试需保留 forbidden");
});
