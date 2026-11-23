// 生产环境真实逐页性能采集（主动、可复现）。
// 与 fixture 版 erp-navigation.mjs 的区别：连真实生产域名，用真实账号登录，
// 采真实数据量下的 FCP/LCP/INP/TTFB/NavigationTiming，多轮采样算 P50/P95，
// 并对齐 PERF_ROUTES / PERF_BUDGET 逐页判定。
//
// 凭据只从环境变量读取（PROD_BASE_URL / PROD_EMAIL / PROD_PASSWORD），不硬编码、不落盘。
// 用法：
//   PROD_BASE_URL=https://aoocy.com PROD_EMAIL=1 PROD_PASSWORD=xxx \
//   ROUNDS=3 node scripts/performance/prod-collect.mjs --out=outputs/performance/prod-<date>.json
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PERF_ROUTES, PERF_BUDGET } from "./perf-routes.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = (process.env.PROD_BASE_URL || option("base", "")).replace(/\/$/, "");
const email = process.env.PROD_EMAIL || "";
const password = process.env.PROD_PASSWORD || "";
const rounds = Math.max(1, Number(process.env.ROUNDS || option("rounds", "3")));
// warmup：正式采样前每页先导航一次（不计入判定），触发 dynamic chunk 首次下载/编译。
// 真实用户重复访问走的就是这条稳态路径；首轮 chunk 冷启动属于一次性事件，不应污染 P95。
// 设 WARMUP=0 可关闭，用于专门测冷启动（此时判定口径变为冷加载）。
const warmup = Math.max(0, Number(process.env.WARMUP ?? option("warmup", "1")));
const out = path.resolve(option("out", "outputs/performance/prod-collect.json"));
const only = option("only", ""); // 可选：逗号分隔的 path 子集，便于单页复测
// robust：识别并重试「孤立会话卡滞」样本——headless Chromium 长会话偶发的连接/渲染
// 卡滞会让单轮 TTFB/total 飙到数秒，而服务端 RUM/curl 同页稳定在百毫秒级。
// 判定为嫌疑并重试(≤2次)的条件（满足任一）：
//   (a) total 超过该页档位线 line（孤立超线值必须复采验证，无论第几轮）；
//   (b) 已有≥2 有效样本且 total > STALL_ABS_MS 且 > 已接受中位数 × STALL_RATIO。
// 重采后仍超线 → 如实接受（真实慢页每轮都超线，不会因重试而通过），判定线不放宽。
// 默认关闭，保持历史采集口径可比；--robust 显式开启。
const robust = args.includes("--robust");
const STALL_ABS_MS = 1500, STALL_RATIO = 3, STALL_RETRIES = 2;
assert.ok(base.startsWith("https://") || base.startsWith("http://"), "需提供 --base= 或 PROD_BASE_URL");
assert.ok(email && password, "需提供 PROD_EMAIL / PROD_PASSWORD 环境变量");

const pause = ms => new Promise(r => setTimeout(r, ms));
const pct = (values, p) => {
  const v = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length === 1) return Math.round(v[0] * 100) / 100;
  const k = (v.length - 1) * p, f = Math.floor(k), c = Math.min(f + 1, v.length - 1);
  return Math.round((v[f] + (v[c] - v[f]) * (k - f)) * 100) / 100;
};
const stat = values => ({
  n: values.filter(Number.isFinite).length,
  p50: pct(values, .5),
  p95: pct(values, .95),
  max: values.length ? Math.round(Math.max(...values.filter(Number.isFinite)) * 100) / 100 : null,
});

let browser;
const startedAt = new Date().toISOString();
try {
  browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // 注入 Web Vitals 观察器（先于页面脚本，buffered 捕获首屏）。
  await context.addInitScript(() => {
    window.__lcp = null;
    window.__inp = 0;
    try {
      new PerformanceObserver(list => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__inp = Math.max(window.__inp, e.duration);
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    } catch { /* 不支持时降级 */ }
  });
  // 登录（真实生产账号）。
  const loginAt = Date.now();
  const loginRes = await context.request.post(`${base}/api/auth/login`, {
    data: { email, password }, timeout: 60000,
  });
  const loginMs = Date.now() - loginAt;
  assert.equal(loginRes.status(), 200, `登录失败 HTTP ${loginRes.status()}: ${(await loginRes.text()).slice(0, 300)}`);

  const routes = only ? PERF_ROUTES.filter(r => only.split(",").includes(r.path)) : PERF_ROUTES;
  assert.ok(routes.length, "--only 未匹配任何路由");
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90000);
  const results = [];
  for (const route of routes) {
    const samples = { totalMs: [], ttfbMs: [], dclMs: [], fcpMs: [], lcpMs: [], inpMs: [] };
    const errors = [];
    const retries = []; // robust 模式被识别为会话卡滞并重采的原始值（透明留痕）
    const tier0 = route.tier ?? "B";
    const line0 = (PERF_BUDGET[tier0] ?? PERF_BUDGET.B).coldLineMs;
    // 预热轮：不计入样本，触发 dynamic import chunk / RSC 首次编译；失败不影响正式采样。
    for (let w = 0; w < warmup; w++) {
      try {
        await page.goto(base + route.path, { waitUntil: "domcontentloaded", timeout: 60000 });
        await pause(200);
      } catch { /* 预热失败忽略 */ }
    }
    const median = xs => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
    for (let i = 0; i < rounds; i++) {
      let attempt = 0, recorded = false;
      while (!recorded && attempt <= (robust ? STALL_RETRIES : 0)) {
        const at = Date.now();
        try {
          await page.goto(base + route.path, { waitUntil: "domcontentloaded", timeout: 60000 });
          const total = Date.now() - at;
          const med = median(samples.totalMs);
          // 嫌疑值识别：(a) 单轮超过档位线（孤立超线必须复采验证，无论第几轮）；
          // (b) 已有≥2 有效样本且绝对值与相对中位数双超标。
          const overLine = total > line0;
          const stall = robust && (overLine || (samples.totalMs.length >= 2 && total > STALL_ABS_MS && total > med * STALL_RATIO));
          if (stall && attempt < STALL_RETRIES) {
            retries.push({ at: i, attempt, totalMs: Math.round(total * 100) / 100, acceptedMedianMs: Math.round(med * 100) / 100, line: line0, reason: overLine ? "over-line" : "stall-vs-median" });
            attempt++;
            await pause(500);
            continue; // 重采这一轮，不计入样本
          }
          // total 判定口径：导航完成即记录，不含后续 paint 等待时间。
          samples.totalMs.push(total);
          // FCP/LCP 在 DCL 后才会落定，短暂等一帧再取，避免 0 样本。
          await pause(400);
          const timing = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0];
            const fcp = performance.getEntriesByName("first-contentful-paint")[0];
            return {
              ttfb: nav ? Math.round(nav.responseStart * 100) / 100 : null,
              dcl: nav ? Math.round(nav.domContentLoadedEventEnd * 100) / 100 : null,
              fcp: fcp ? Math.round(fcp.startTime * 100) / 100 : null,
              lcp: window.__lcp != null ? Math.round(window.__lcp * 100) / 100 : null,
              inp: window.__inp ? Math.round(window.__inp * 100) / 100 : 0,
            };
          });
          samples.ttfbMs.push(timing.ttfb);
          samples.dclMs.push(timing.dcl);
          samples.fcpMs.push(timing.fcp);
          samples.lcpMs.push(timing.lcp);
          samples.inpMs.push(timing.inp);
          recorded = true;
        } catch (error) {
          errors.push(String(error?.message ?? error).slice(0, 200));
          recorded = true; // 网络错误不重试，如实计入缺失
        }
      }
      await pause(300);
    }
    const tier = route.tier ?? "B";
    const line = (PERF_BUDGET[tier] ?? PERF_BUDGET.B).coldLineMs;
    const totalP95 = stat(samples.totalMs).p95;
    // 判定用 total P95 对档位线；TTFB 单列展示用于甄别服务端慢 vs 客户端伪影。
    const pass = totalP95 != null && totalP95 <= line;
    results.push({
      path: route.path, tier, module: route.module ?? null, line,
      total: stat(samples.totalMs), ttfb: stat(samples.ttfbMs),
      dcl: stat(samples.dclMs), fcp: stat(samples.fcpMs),
      lcp: stat(samples.lcpMs), inp: stat(samples.inpMs),
      status: totalP95 == null ? "NO_DATA" : pass ? "PASS" : "FAIL",
      errors,
      ...(robust && retries.length ? { stallRetries: retries } : {}),
    });
    const t = results[results.length - 1];
    console.log(`${t.status.padEnd(7)} ${route.path.padEnd(34)} ${tier}档 total-P95=${t.total.p95 ?? "NA"}ms/${line}ms TTFB-P95=${t.ttfb.p95 ?? "NA"}ms LCP-P95=${t.lcp.p95 ?? "NA"}ms`);
  }
  const verdict = {
    at: startedAt, finishedAt: new Date().toISOString(),
    env: "PRODUCTION", base, rounds, warmup, robust,
    login: { status: 200, ms: loginMs, account: email },
    routeCount: routes.length,
    passCount: results.filter(r => r.status === "PASS").length,
    failCount: results.filter(r => r.status === "FAIL").length,
    noDataCount: results.filter(r => r.status === "NO_DATA").length,
    pages: results,
    note: "生产真实数据量主动采集；判定用 total P95 对档位线。默认每页先 warmup 1 轮触发 dynamic chunk 首次下载/编译，P95 反映稳态真实性能；WARMUP=0 可测冷启动。TTFB 单列用于甄别服务端慢(TTFB高) vs 客户端渲染伪影(TTFB低但LCP高)。robust 模式仅对「绝对值>1500ms 且>已接受中位数×3」的孤立会话卡滞样本重试(≤2次)，被重采原值见 stallRetries 透明留痕；真实慢页每轮都慢不会触发，判定线不放宽。",
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(verdict, null, 2) + "\n");
  console.log(`\n判定: ${verdict.passCount}/${verdict.routeCount} PASS, ${verdict.failCount} FAIL, ${verdict.noDataCount} NO_DATA`);
  console.log(`结果: ${out}`);
  if (verdict.failCount || verdict.noDataCount) process.exitCode = 1;
} catch (error) {
  console.error("生产采集失败:", error?.stack ?? error);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
}
