#!/usr/bin/env node
/**
 * 供应链漏洞闸门（基线豁免 + 新增阻断，只阻断新增风险，不锁死 CI）。
 *
 * 运行 `npm audit --omit=dev --json`，按 audit-baseline.json 的 accepted 清单比对：
 *   - 基线内的包/级别：放行，但到期（reviewBy）即转为阻断，提醒复审。
 *   - 基线外的包：按阈值（默认 high）阻断。
 *   - 基线内包出现更严重级别：阻断（防止已豁免包恶化）。
 *   - moderate 及以下：默认不阻断，仅输出统计。
 *
 * 用法：
 *   node scripts/runtime/audit-dependencies.mjs
 *   node scripts/runtime/audit-dependencies.mjs --json
 *   node scripts/runtime/audit-dependencies.mjs --refresh   # 以当前结果重写 accepted 基线（人工确认后）
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASELINE = path.join(ROOT, "scripts/runtime/audit-baseline.json");
const SEVERITY_ORDER = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const jsonMode = process.argv.includes("--json");
const refresh = process.argv.includes("--refresh");

function runAudit() {
  try {
    const out = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    return JSON.parse(out);
  } catch (error) {
    // npm audit 在网络失败时可能非零且无 JSON；将其视为不可判定，安全起见阻断。
    const text = String(error?.stdout ?? "");
    try { return JSON.parse(text); }
    catch {
      if (!jsonMode) console.error("无法执行 npm audit（网络或注册表不可用），按 fail-closed 阻断。");
      process.exit(2);
    }
  }
}

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, "utf8")); }
  catch { return { policy: { auditLevel: "high" }, accepted: [] }; }
}

const report = runAudit();
const baseline = loadBaseline();
const threshold = SEVERITY_ORDER[baseline.policy?.auditLevel ?? "high"] ?? 3;
const today = new Date().toISOString().slice(0, 10);
const accepted = new Map((baseline.accepted ?? []).map(item => [item.package, item]));

const findings = [];
const blockers = [];
for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
  const severity = String(info.severity ?? "info");
  const level = SEVERITY_ORDER[severity] ?? 0;
  const item = accepted.get(name);
  const finding = { package: name, severity, isDirect: Boolean(info.isDirect), accepted: Boolean(item), backlog: item?.backlog ?? null };
  findings.push(finding);
  if (level < threshold && !item) continue; // 低于阈值且未登记：仅记录
  if (!item) {
    blockers.push(`${name} (${severity}) 未登记豁免且达到阻断阈值`);
    continue;
  }
  if (level > SEVERITY_ORDER[item.severity ?? "high"]) {
    blockers.push(`${name} 严重级别由 ${item.severity} 升级为 ${severity}，需复审`);
    continue;
  }
  if (item.reviewBy && item.reviewBy < today) {
    blockers.push(`${name} 豁免已于 ${item.reviewBy} 到期，需复审或修复`);
  }
}

const summary = {
  total: report.metadata?.vulnerabilities?.total ?? findings.length,
  critical: report.metadata?.vulnerabilities?.critical ?? 0,
  high: report.metadata?.vulnerabilities?.high ?? 0,
  moderate: report.metadata?.vulnerabilities?.moderate ?? 0,
  accepted: findings.filter(f => f.accepted).length,
  blockers,
};

if (refresh) {
  const next = {
    policy: baseline.policy ?? { auditLevel: "high", reviewCadenceDays: 90 },
    accepted: findings.map(f => ({
      package: f.package,
      severity: f.severity,
      reason: accepted.get(f.package)?.reason ?? "CI 人工确认纳入基线",
      backlog: accepted.get(f.package)?.backlog ?? "deps-routine-upgrade",
      reviewBy: accepted.get(f.package)?.reviewBy ?? new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
    })),
  };
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + "\n");
  if (!jsonMode) console.log("已刷新漏洞基线，请人工复核 diff 后提交。");
  process.exit(0);
}

if (jsonMode) console.log(JSON.stringify({ summary, findings }, null, 2));
else {
  console.log("供应链漏洞闸门");
  console.log(`  总计 ${summary.total}（critical ${summary.critical} / high ${summary.high} / moderate ${summary.moderate}）`);
  console.log(`  基线豁免 ${summary.accepted} 项，新增阻断 ${blockers.length} 项`);
  for (const b of blockers) console.log(`  ✗ ${b}`);
  if (!blockers.length) console.log("  ✓ 未发现新增或恶化的漏洞");
}

if (blockers.length) process.exit(1);
