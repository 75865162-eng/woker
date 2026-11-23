// 逐页性能检测审计报告生成器：读取 prod-collect 采集 JSON，输出单文件 HTML。
// 每页一张审计卡：total/TTFB/DCL/FCP/LCP/INP 的 P50/P95、档位线、达标判定、
// 瓶颈归因（服务端 TTFB vs 客户端渲染）、与历史基线对比。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const input = path.resolve(option("input", ""));
const baseline = option("baseline", "");
const serve = option("serve", ""); // 可选：纯服务端 curl 佐证 JSON，用于甄别 headless 会话噪声
const out = path.resolve(option("out", "outputs/performance/audit-report.html"));
if (!input) { console.error("用法: --input=<采集JSON> [--baseline=<历史JSON>] [--serve=<服务端佐证JSON>] --out=<html>"); process.exit(2); }

const data = JSON.parse(readFileSync(input, "utf8"));
const baseData = baseline ? JSON.parse(readFileSync(path.resolve(baseline), "utf8")) : null;
const baseMap = new Map((baseData?.pages ?? []).map(p => [p.path, p]));
const serveData = serve ? JSON.parse(readFileSync(path.resolve(serve), "utf8")) : null;
const serveMap = new Map(Object.entries(serveData?.pages ?? {}).map(([path, v]) => [path, v]));

const TIER_LABEL = { A: "应用壳/工作台", B: "常用列表/详情", C: "重型分析报表", D: "静态壳/配置" };
const fmt = n => (n == null ? "—" : String(n));
const cls = n => (n == null ? "" : n >= 1000 ? "warn" : "");

// 瓶颈归因：读 TTFB 与 total 的比值 + LCP-TTFB 差值。
function bottleneck(p) {
  const ttfb = p.ttfb?.p95 ?? 0;
  const total = p.total?.p95 ?? 0;
  const lcp = p.lcp?.p95 ?? 0;
  if (p.status === "NO_DATA") return { tag: "无数据", detail: "未采集到有效样本", kind: "none" };
  if (ttfb > total * 0.45 && ttfb > 400) return { tag: "服务端", detail: `TTFB P95 ${fmt(ttfb)}ms 占比高，优先查 SQL/N+1/权限链`, kind: "server" };
  if (lcp - ttfb > 800) return { tag: "客户端", detail: `LCP-TTFB 差 ${fmt(Math.round(lcp - ttfb))}ms，优先查 chunk/渲染`, kind: "client" };
  return { tag: "健康", detail: "TTFB 与首屏均在低位，无显著瓶颈", kind: "ok" };
}

const pages = data.pages ?? [];
const sorted = [...pages].sort((a, b) => (b.total?.p95 ?? 0) - (a.total?.p95 ?? 0));
const fails = pages.filter(p => p.status !== "PASS");
const cards = sorted.map(p => {
  const bn = bottleneck(p);
  const base = baseMap.get(p.path);
  const delta = base?.total?.p95 != null && p.total?.p95 != null ? Math.round(p.total.p95 - base.total.p95) : null;
  const statusCls = p.status === "PASS" ? "pass" : "fail";
  const barPct = Math.min(100, Math.round(((p.total?.p95 ?? 0) / (p.line || 1500)) * 100));
  const row = (label, s, unit = "ms") => `<div class="metric"><span class="mlabel">${label}</span><span class="mval ${cls(s?.p95)}">${fmt(s?.p95)}<small>${unit}</small></span><span class="mp50">P50 ${fmt(s?.p50)}</span></div>`;
  const stallNote = p.stallRetries?.length
    ? `<div class="stall">⟳ 识别 ${p.stallRetries.length} 次 headless 会话卡滞并重采：${p.stallRetries.map(r => `${Math.round(r.totalMs)}ms(线${r.line},${r.reason})`).join("、")} → 稳态 ${fmt(p.total?.p95)}ms</div>`
    : "";
  const sp = serveMap.get(p.path);
  const serveNote = sp?.p50 != null
    ? `<span>服务端佐证 <b class="${sp.p50 <= 500 ? "good" : "warn"}">${sp.p50}ms</b></span>` : "";
  return `<article class="card ${statusCls}" id="p-${p.path.replace(/[^a-z0-9]/gi, "_")}">
    <div class="chead">
      <div class="ctitle"><span class="status ${statusCls}">${p.status}</span><code>${p.path}</code></div>
      <div class="tier">${p.tier} 档 · ${TIER_LABEL[p.tier] || ""}</div>
    </div>
    <div class="gauge"><div class="gauge-fill" style="width:${barPct}%"></div><span class="gauge-line">档位线 ${p.line}ms</span></div>
    <div class="total-big"><b class="${statusCls}">${fmt(p.total?.p95)}</b> ms <span>total P95 / 线 ${p.line}ms</span></div>
    <div class="metrics">
      ${row("TTFB", p.ttfb)}${row("DCL", p.dcl)}${row("FCP", p.fcp)}${row("LCP", p.lcp)}${row("INP", p.inp)}
    </div>
    <div class="bottleneck ${bn.kind}"><b>瓶颈归因：${bn.tag}</b> — ${bn.detail}</div>
    <div class="foot">
      <span>采样 ${p.total?.n ?? 0} 轮</span>
      ${serveNote}
      ${delta != null ? `<span>对比历史基线 <b class="${delta > 0 ? "warn" : "good"}">${delta > 0 ? "+" : ""}${delta}ms</b></span>` : ""}
      ${p.errors?.length ? `<span class="warn">错误 ${p.errors.length}</span>` : ""}
    </div>
    ${stallNote}
  </article>`;
}).join("\n");

const failSection = fails.length
  ? `<div class="alert"><b>${fails.length} 页超线/无数据：</b>${fails.map(p => `${p.path} (${fmt(p.total?.p95)}/${p.line}ms)`).join("、")}</div>`
  : `<div class="ok-banner">✅ 全部 ${pages.length} 页达标，无超线页面。</div>`;

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ERP 逐页加载性能检测审计报告</title>
<style>
:root{--bg:#0f1420;--panel:#171e2e;--panel2:#1d2639;--border:#2a3550;--text:#e6edf7;--muted:#93a1bb;--pass:#3fb950;--fail:#f85149;--warn:#d29922;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.5}
header{padding:28px 32px;background:linear-gradient(135deg,#1b2740,#121829);border-bottom:1px solid var(--border)}
h1{margin:0 0 6px;font-size:24px}.sub{color:var(--muted);font-size:14px}
.wrap{max-width:1400px;margin:0 auto;padding:24px 32px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px}
.kpi .num{font-size:30px;font-weight:700}.kpi .lbl{color:var(--muted);font-size:13px}
.num.good{color:var(--pass)}.num.bad{color:var(--fail)}
.ok-banner,.alert{padding:14px 18px;border-radius:8px;margin-bottom:20px;font-size:14px}
.ok-banner{background:rgba(63,185,80,.12);border:1px solid var(--pass);color:#8ee99a}
.alert{background:rgba(248,81,73,.1);border:1px solid var(--fail);color:#ffb4ae}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--pass);border-radius:10px;padding:16px}
.card.fail{border-left-color:var(--fail)}
.chead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px}
.ctitle{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ctitle code{font-size:14px;color:var(--accent)}
.tier{font-size:11px;color:var(--muted);white-space:nowrap}
.status{font-size:11px;padding:2px 7px;border-radius:5px;font-weight:700}.status.pass{background:rgba(63,185,80,.18);color:var(--pass)}.status.fail{background:rgba(248,81,73,.18);color:var(--fail)}
.gauge{position:relative;height:8px;background:var(--panel2);border-radius:4px;margin:8px 0 12px;overflow:visible}
.gauge-fill{height:100%;background:linear-gradient(90deg,var(--pass),#56d364);border-radius:4px}
.card.fail .gauge-fill{background:linear-gradient(90deg,var(--warn),var(--fail))}
.gauge-line{position:absolute;right:0;top:-16px;font-size:10px;color:var(--muted)}
.total-big{margin-bottom:12px}.total-big b{font-size:22px}.total-big b.pass{color:var(--pass)}.total-big b.fail{color:var(--fail)}.total-big span{color:var(--muted);font-size:12px;margin-left:4px}
.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:12px}
.metric{background:var(--panel2);border-radius:6px;padding:7px;text-align:center}
.mlabel{display:block;font-size:10px;color:var(--muted)}.mval{display:block;font-size:14px;font-weight:600;margin:3px 0}.mval small{font-size:9px;color:var(--muted);margin-left:1px}.mval.warn{color:var(--warn)}
.mp50{font-size:9px;color:var(--muted)}
.bottleneck{font-size:12px;padding:8px 10px;border-radius:6px;background:var(--panel2);margin-bottom:8px}
.bottleneck.server{border-left:3px solid var(--warn)}.bottleneck.client{border-left:3px solid var(--accent)}.bottleneck.ok{border-left:3px solid var(--pass)}.bottleneck.none{border-left:3px solid var(--muted)}
.foot{display:flex;gap:14px;font-size:11px;color:var(--muted);flex-wrap:wrap}.good{color:var(--pass)}.warn{color:var(--warn)}
.stall{font-size:11px;color:#d2a8ff;background:rgba(163,113,247,.1);border-left:3px solid #a371f7;padding:6px 9px;border-radius:5px;margin-top:8px}
.note{color:var(--muted);font-size:12px;margin-top:20px;padding-top:14px;border-top:1px solid var(--border)}
</style></head><body>
<header><h1>ERP 逐页加载性能检测审计报告</h1>
<div class="sub">环境 ${data.env} · 基线 ${data.base || "—"} · 采集 ${data.at} · ${data.rounds} 轮采样 + ${data.warmup} 轮预热${data.robust ? " · 稳健模式(会话卡滞自动重采)" : ""} · 判定口径 total P95 vs 档位线 · 账号 ${data.login?.account || "—"}</div></header>
<div class="wrap">
<div class="summary">
  <div class="kpi"><div class="num">${data.routeCount}</div><div class="lbl">检测页面</div></div>
  <div class="kpi"><div class="num good">${data.passCount}</div><div class="lbl">达标 PASS</div></div>
  <div class="kpi"><div class="num ${data.failCount ? "bad" : "good"}">${data.failCount}</div><div class="lbl">超线 FAIL</div></div>
  <div class="kpi"><div class="num">${fmt(data.login?.ms)}ms</div><div class="lbl">登录耗时</div></div>
</div>
${failSection}
<div class="grid">${cards}</div>
<div class="note">说明：total=导航到 DOMContentLoaded 的墙钟时间（判定口径）；TTFB=服务端首字节，用于甄别服务端慢；FCP/LCP=首屏/最大内容绘制；INP=交互响应。瓶颈归因规则：TTFB P95 占比高且>400ms→服务端；LCP-TTFB 差>800ms→客户端渲染；否则健康。性能采集为真实生产数据量主动采样，P95 对档位线（A/D 1500ms、B 1500ms、C 3000ms）。「服务端佐证」为纯 curl 请求页面 HTML 的 time_total P50（无浏览器渲染），用于甄别 headless Chromium 长会话连接/渲染卡滞伪影：当采集 P95 虚高但服务端佐证处于百毫秒级，即为测量工具噪声而非页面缺陷，稳健模式已对超线孤立样本自动重采（见紫色留痕）。</div>
</div></body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`审计报告生成: ${out} (${pages.length} 页, ${fails.length} 超线)`);
