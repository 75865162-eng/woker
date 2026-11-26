#!/usr/bin/env node
/**
 * 生产部署自动报告（规范第 9 项）。
 *
 * 设计原则：只读消费既有证据，不侵入发布脚本，不改变发布契约。
 * 输入：
 *   - dist/release-manifest.json   CI 打包产物清单（版本/测试档位/SHA256/大小）
 *   - dist/deployment-plan.json    CI 变更计划（变更类型/迁移/重启范围）
 *   - dist/ci-job-timings.json     GitHub Actions 本次 run 的各 job 耗时
 *   - dist/deploy-console.log      deploy-ci-artifact.sh 的完整控制台输出
 * 输出：简洁中文报告（Markdown），写到 stdout 或 --output 指定文件。
 *
 * deploy-console.log 里 release.sh 末尾会 cat RELEASE-RESULT.json，
 * 本脚本用花括号配平从中提取验收结果，无需额外 SSH 往返。
 */
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";

/** 从文本中提取所有顶层 JSON 对象（花括号配平，跳过字符串内的括号）。 */
export function extractJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch { /* 非 JSON 文本忽略 */ }
        start = -1;
      }
    }
  }
  return objects;
}

/**
 * 剥离每行开头的 GitHub Actions / 日志采集器时间戳前缀。
 * CI 里 tee 捕获的原始 stdout 无前缀；用 API 下载的 job 日志则带 `2026-...Z ` 前缀。
 * 两种来源都要能解析，保证报告本地可复现、CI 可运行。
 */
export function stripLogTimestamps(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "").replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ""))
    .join("\n");
}

/** 解析 deploy 控制台日志：阶段时间戳 + RELEASE-RESULT + RELEASE 元数据。 */
export function parseDeployConsole(rawText) {
  const text = stripLogTimestamps(rawText);
  const stages = [];
  const stageRe = /\[deploy (\d{2}):(\d{2}):(\d{2})\] ([^\r\n]+)/g;
  let match;
  while ((match = stageRe.exec(text)) !== null) {
    const [hh, mm, ss] = [Number(match[1]), Number(match[2]), Number(match[3])];
    stages.push({ seconds: hh * 3600 + mm * 60 + ss, label: match[4].trim() });
  }
  const objects = extractJsonObjects(text);
  const result = objects.find(o => o && (Object.hasOwn(o, "runtimeReleaseVerified") || (Object.hasOwn(o, "services") && Object.hasOwn(o, "status")))) || null;
  const release = objects.find(o => o && Object.hasOwn(o, "appVersion") && Object.hasOwn(o, "commit") && !Object.hasOwn(o, "status")) || null;
  return { stages, result, release };
}

/** 由阶段时间戳计算部署各阶段耗时（秒）。跨天按 +24h 兜底。 */
export function computeDeployDurations(stages) {
  if (!stages.length) return {};
  const at = (predicate) => stages.find(s => predicate(s.label));
  const delta = (a, b) => {
    if (!a || !b) return null;
    let d = b.seconds - a.seconds;
    if (d < 0) d += 24 * 3600;
    return d;
  };
  const first = stages[0];
  const last = stages[stages.length - 1];
  const uploadScript = at(l => l.includes("上传发布脚本"));
  const uploadArtifact = at(l => l.includes("上传发布产物"));
  const serverStart = at(l => l.includes("服务器端原子发布与验收开始"));
  const serverDone = at(l => l.includes("服务器端发布完成"));
  return {
    total: delta(first, last),
    uploadScript: delta(uploadScript, uploadArtifact),
    uploadArtifact: delta(uploadArtifact, serverStart),
    serverRelease: delta(serverStart, serverDone),
  };
}

/** 解析 GitHub Actions jobs 耗时。 */
export function computeJobDurations(timings) {
  const out = {};
  const jobs = timings && Array.isArray(timings.jobs) ? timings.jobs : [];
  for (const job of jobs) {
    if (!job.started_at || !job.completed_at) continue;
    const sec = Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 1000);
    out[job.name] = { seconds: sec, conclusion: job.conclusion || job.status };
  }
  return out;
}

export function humanDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function humanBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

const YES = (v) => (v === true ? "是" : v === false ? "否" : "—");

/** 依据 deployment-plan 归纳变更类型标签。 */
export function changeTypes(plan) {
  if (!plan) return [];
  const types = [];
  if (plan.uiChanged) types.push("UI");
  if (plan.codeChanged) types.push("业务逻辑");
  if (Array.isArray(plan.changedPaths) && plan.changedPaths.some(p => /^src\/app\/api\//.test(p))) types.push("API");
  if (plan.prismaSchemaChanged || plan.prismaMigrationChanged) types.push("数据库");
  if (Array.isArray(plan.changedPaths) && plan.changedPaths.some(p => /auth|permission|rbac|security|tenant/i.test(p))) types.push("权限安全");
  if (plan.workerChanged) types.push("Worker");
  if (plan.deploymentChanged) types.push("部署底层");
  return types.length ? types : ["文档/其他"];
}

/** 生成结构化报告对象。 */
export function buildReport({ manifest, plan, timings, consoleText }) {
  const { stages, result, release } = parseDeployConsole(consoleText || "");
  const deployDurations = computeDeployDurations(stages);
  const jobDurations = computeJobDurations(timings);
  const commit = (result && result.commit) || (release && release.commit) || (manifest && manifest.commit) || "unknown";
  const status = (result && result.status) || "unknown";
  const rollback = result && result.rollback ? result.rollback : null;
  return {
    version: {
      commit,
      appVersion: (release && release.appVersion) || "—",
      branch: (manifest && manifest.branch) || "—",
      sha256: (result && result.artifactSha256) || (manifest && manifest.artifactSha256) || "—",
      artifactSize: humanBytes(manifest && manifest.artifactSize),
    },
    durations: { deploy: deployDurations, jobs: jobDurations },
    change: {
      types: changeTypes(plan),
      tier: (manifest && manifest.testTier) || "—",
      scope: (manifest && manifest.testScope) || 0,
      fileCount: plan && Array.isArray(plan.changedPaths) ? plan.changedPaths.length : "—",
    },
    verification: {
      status,
      health: result ? result.health || "—" : "—",
      runtimeVerified: result ? YES(result.runtimeReleaseVerified) : "—",
      migration: result ? result.migration || "—" : "—",
      services: (result && result.services) || null,
      diskAvailableKb: result ? result.diskAvailableKb : null,
    },
    rollback: {
      status: rollback ? rollback.status || "—" : "—",
      release: rollback ? rollback.releaseId || "—" : "—",
      database: rollback ? rollback.database || "—" : "—",
    },
    failure: {
      phase: result ? result.failurePhase || "—" : "—",
      error: result ? result.error || "—" : "—",
    },
  };
}

/** 渲染为简洁 Markdown。 */
export function toMarkdown(r) {
  const v = r.version;
  const d = r.durations.deploy;
  const jobs = r.durations.jobs;
  const c = r.change;
  const ver = r.verification;
  const svc = ver.services || {};
  const jobLines = Object.keys(jobs).length
    ? Object.entries(jobs).map(([name, x]) => `| ${name} | ${humanDuration(x.seconds)} | ${x.conclusion} |`).join("\n")
    : "| — | — | — |";
  const serviceLine = Object.keys(svc).length
    ? Object.entries(svc).map(([k, val]) => `${k}=${val}`).join(" · ")
    : "—";
  const statusIcon = ver.status === "passed" ? "✅ passed" : `❌ ${ver.status}`;
  return `# ERP 生产部署报告

## 部署版本
| 项 | 值 |
|---|---|
| Commit | \`${v.commit}\` |
| 应用版本 | ${v.appVersion} |
| 分支 | ${v.branch} |
| 产物 SHA256 | \`${String(v.sha256).slice(0, 24)}…\` |
| 产物大小 | ${v.artifactSize} |

## 耗时
- **部署总耗时（传输+发布+验收）**：${humanDuration(d.total)}
  - 上传发布脚本：${humanDuration(d.uploadScript)}
  - 上传产物（跨境传输）：${humanDuration(d.uploadArtifact)}
  - 服务器端原子发布与验收：${humanDuration(d.serverRelease)}
- CI 检查阶段（各 job 墙钟）：

| Job | 耗时 | 结论 |
|---|---|---|
${jobLines}

## 变更类型
- 类型：${c.types.join(" / ")}
- 变更分级：${c.tier}（测试范围 ${c.scope} 项 / 变更文件 ${c.fileCount} 个）

## 部署结果
- **状态**：${statusIcon}
- 健康检查：${ver.health}
- 运行时版本校验：${ver.runtimeVerified}
- 数据库迁移：${ver.migration}

## 业务验收
- 服务与存储：${serviceLine}
- 磁盘可用：${ver.diskAvailableKb ? `${(Number(ver.diskAvailableKb) / 1024 / 1024).toFixed(1)}G` : "—"}

## 回滚
- 是否回滚：${r.rollback.status}
- 回滚版本：${r.rollback.release}
- 数据库：${r.rollback.database}（发布脚本契约：数据库永不回滚）

## 失败原因
- 阶段：${r.failure.phase}
- 错误：${r.failure.error}
`;
}

function readJson(file, fallback) {
  if (!file || !existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback = "") => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
  };
  const manifest = readJson(arg("manifest", "dist/release-manifest.json"), null);
  const plan = readJson(arg("plan", "dist/deployment-plan.json"), null);
  const timings = readJson(arg("timings", "dist/ci-job-timings.json"), null);
  const consoleFile = arg("console", "dist/deploy-console.log");
  const consoleText = consoleFile && existsSync(consoleFile) ? readFileSync(consoleFile, "utf8") : "";
  const report = buildReport({ manifest, plan, timings, consoleText });
  const md = toMarkdown(report);
  const output = arg("output", "");
  if (output) {
    appendFileSync(output, `\n${md}\n`);
    process.stdout.write(`Deployment report appended to ${output}\n`);
  } else {
    process.stdout.write(md);
  }
}

const invoked = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invoked && (invoked === "deployment-report.mjs" || invoked.endsWith("/deployment-report.mjs"))) {
  main();
}
