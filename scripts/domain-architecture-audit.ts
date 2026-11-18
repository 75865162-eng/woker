/**
 * Amazon 数据域架构账本审计（只读）。
 *
 * 回答三件事：SP-API / Ads API 能同步的域有哪些、各自落地页在哪、自动计划是否注册。
 * 不读凭证、不发网络请求、不连数据库；仅静态核对源码中的架构映射与一致性。
 *
 * 用法：
 *   npm run ops:domain-audit
 *   npm run ops:domain-audit -- --json
 * 退出码：0=架构自检通过；1=存在缺口（gaps 非空）；2=加载异常。
 */
import { getDomainArchitecture, auditDomainArchitecture, type DomainArchitectureRow } from "../src/lib/amazon/domain-architecture";

function pad(value: string, width: number): string {
  const chars = [...value];
  const w = chars.reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  if (w <= width) return value + " ".repeat(width - w);
  // 超宽时截断并留一个空格分隔，避免长 ID 与下一列粘连。
  let out = "", used = 0;
  for (const ch of chars.slice(0, width - 3)) { const cw = ch.charCodeAt(0) > 255 ? 2 : 1; if (used + cw > width - 3) break; out += ch; used += cw; }
  return out + "..." + " ";
}

function table(rows: DomainArchitectureRow[]): string {
  const head = [pad("域 ID", 26), pad("落地页", 34), pad("自动计划", 20), pad("实现", 6), "说明"];
  const lines = [head.join("")];
  lines.push("-".repeat(120));
  for (const r of rows) {
    const schedule = r.schedule.registered
      ? `${r.schedule.intervalMinutes ?? "-"}分`
      : r.schedule.scheduler === "authorization-flow" ? "授权流" : "无";
    lines.push([
      pad(`${r.provider === "amazon_ads" ? "[ADS] " : ""}${r.id}`, 26),
      pad(`${r.landing.surface} ${r.landing.route}`, 34),
      pad(schedule, 20),
      pad(r.implemented ? "是" : "规划", 6),
      r.landing.note,
    ].join(""));
  }
  return lines.join("\n");
}

function main(): number {
  const asJson = process.argv.includes("--json");
  const rows = getDomainArchitecture();
  const audit = auditDomainArchitecture();

  if (asJson) {
    process.stdout.write(JSON.stringify({ rows, audit }, null, 2) + "\n");
    return audit.ok ? 0 : 1;
  }

  process.stdout.write("=== Amazon 数据域架构账本（SP-API + Ads API，静态核对，无需真实数据）===\n\n");
  process.stdout.write("## SP-API 数据域\n");
  process.stdout.write(table(rows.filter(r => r.provider === "amazon_sp_api")) + "\n\n");
  process.stdout.write("## Ads API 能力（SP 产品）\n");
  process.stdout.write(table(rows.filter(r => r.provider === "amazon_ads")) + "\n\n");
  process.stdout.write("## 架构自检\n");
  for (const c of audit.checks) process.stdout.write(`  [${c.ok ? "PASS" : "FAIL"}] ${c.id} — ${c.detail}\n`);
  process.stdout.write(`\n  计数：SP 域 ${audit.counts.spDomains}（已实现 ${audit.counts.spImplemented}，专用落地 ${audit.counts.spWithWorkbench}，有自动计划 ${audit.counts.spWithSchedule}）· Ads SP 能力 ${audit.counts.adsCapabilities}（已实现 ${audit.counts.adsImplemented}）\n`);
  process.stdout.write(`\n  结论：${audit.ok ? "架构已就绪，等真实数据按域验收" : `存在 ${audit.gaps.length} 处缺口：${audit.gaps.join("；")}`}\n`);
  process.stdout.write("\n说明：落地页/计划存在 ≠ 已有真实数据；数据为空时页面显示 NEEDS_DATA，采集仍凭真实授权与审批执行。\n");
  return audit.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`架构审计加载失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
