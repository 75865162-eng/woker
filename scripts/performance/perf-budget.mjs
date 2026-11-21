// 绝对达标线判定（任务书 CAP-002）：逐页按档位输出 PASS/FAIL，FAIL 非零退出。
// 纯函数可单测；CLI 读取采集 JSON 判定。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PERF_BUDGET, PERF_ROUTES } from "./perf-routes.mjs";

// 单页判定：给定路由档位与实测 cold total（ms），返回判定行。
// 合法超线即 FAIL；无数据/采集失败单独标注，不伪造数值混入 PASS。
export function judgePage(route, sample) {
  const tier = route.tier ?? "B";
  const budget = PERF_BUDGET[tier] ?? PERF_BUDGET.B;
  const line = budget.coldLineMs;
  if (!sample || typeof sample.totalMs !== "number" || !Number.isFinite(sample.totalMs)) {
    return { path: route.path, tier, metric: "coldTotalMs", value: null, line, pass: false, status: "NO_DATA", reason: "未采集到有效数值" };
  }
  const value = Math.round(sample.totalMs * 100) / 100;
  const pass = value <= line;
  return { path: route.path, tier, metric: "coldTotalMs", value, line, pass, status: pass ? "PASS" : "FAIL", reason: pass ? "达标" : `冷加载 ${value}ms 超过 ${tier} 档 ${line}ms` };
}

// 全量判定：把采集结果的 coldPages 按路径对齐路由清单，逐页判；缺采的页记 NO_DATA 并计入 FAIL。
export function judgeAll(result, routes = PERF_ROUTES) {
  const byPath = new Map((result?.coldPages ?? []).map(p => [p.path, p]));
  const rows = routes.map(route => judgePage(route, byPath.get(route.path)));
  const fail = rows.filter(r => !r.pass);
  return {
    at: new Date().toISOString(),
    env: result?.env ?? (result?.mode === "production" ? "fixture-production" : "fixture-dev"),
    head: result?.head ?? null,
    total: rows.length,
    passCount: rows.length - fail.length,
    failCount: fail.length,
    pass: fail.length === 0,
    rows,
    fail,
  };
}

// CLI：node perf-budget.mjs --input=outputs/performance/build.json [--json=判定输出路径]
// 退出码：全 PASS => 0；有 FAIL/NO_DATA => 1；参数/读取错误 => 2。
export function main(argv) {
  const inputArg = argv.find(a => a.startsWith("--input="));
  const jsonArg = argv.find(a => a.startsWith("--json="));
  if (!inputArg) {
    console.error("用法: node perf-budget.mjs --input=<采集JSON> [--json=<判定输出>]");
    return 2;
  }
  let result;
  try {
    result = JSON.parse(readFileSync(inputArg.slice("--input=".length), "utf8"));
  } catch (error) {
    console.error("读取采集 JSON 失败:", error.message);
    return 2;
  }
  const verdict = judgeAll(result);
  const out = JSON.stringify(verdict, null, 2) + "\n";
  if (jsonArg) {
    const p = jsonArg.slice("--json=".length);
    mkdirSync(p.slice(0, p.lastIndexOf("/")) || ".", { recursive: true });
    writeFileSync(p, out);
  }
  const head = verdict.fail.map(f => `  FAIL ${f.path} ${f.tier}档 ${f.value ?? "NO_DATA"}/${f.line}ms (${f.reason})`).join("\n");
  console.log(`逐页判定: ${verdict.passCount}/${verdict.total} PASS, ${verdict.failCount} FAIL [${verdict.env}]`);
  if (head) console.log(head);
  return verdict.pass ? 0 : 1;
}

// 仅在直接执行时跑 CLI（被 import 时不触发）。
if (typeof process !== "undefined" && process.argv?.[1] && /perf-budget\.mjs$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
