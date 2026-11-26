import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import {
  extractJsonObjects,
  stripLogTimestamps,
  parseDeployConsole,
  computeDeployDurations,
  computeJobDurations,
  humanDuration,
  changeTypes,
  buildReport,
  toMarkdown,
} from "../scripts/deployment-report.mjs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("extractJsonObjects：花括号配平，忽略字符串内括号与非 JSON 文本", () => {
  const text = `noise { "a": 1 } tail {"b":{"c":2},"d":"}"} trailing`;
  const objs = extractJsonObjects(text);
  assert.equal(objs.length, 2);
  assert.equal(objs[0].a, 1);
  assert.equal(objs[1].b.c, 2);
  assert.equal(objs[1].d, "}");
});

test("stripLogTimestamps：剥离 GitHub ISO 时间戳但保留 [deploy HH:MM:SS] 阶段标记", () => {
  const line = "2026-11-26T02:45:02.9457495Z {\n2026-11-26T02:43:27.4382570Z [deploy 02:43:27] 上传发布脚本 -> ***";
  const stripped = stripLogTimestamps(line);
  assert.ok(stripped.startsWith("{"));
  assert.match(stripped, /\[deploy 02:43:27\]/);
});

test("computeDeployDurations：阶段耗时与跨天兜底", () => {
  const stages = [
    { seconds: 10, label: "上传发布脚本 -> x" },
    { seconds: 15, label: "上传发布产物 (31M) -> x" },
    { seconds: 28, label: "服务器端原子发布与验收开始" },
    { seconds: 100, label: "服务器端发布完成" },
  ];
  const d = computeDeployDurations(stages);
  assert.equal(d.uploadScript, 5);
  assert.equal(d.uploadArtifact, 13);
  assert.equal(d.serverRelease, 72);
  assert.equal(d.total, 90);
  // 跨天兜底
  const overnight = computeDeployDurations([
    { seconds: 23 * 3600, label: "上传发布脚本" },
    { seconds: 24 * 3600 + 5, label: "上传发布产物" },
  ]);
  assert.equal(overnight.uploadScript, 24 * 3600 + 5 - 23 * 3600);
});

test("computeJobDurations：从 GitHub jobs API 结果计算墙钟耗时", () => {
  const timings = { jobs: [
    { name: "build", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", conclusion: "success" },
    { name: "deploy-production", started_at: "2026-01-01T00:05:00Z", completed_at: null, status: "in_progress" },
  ] };
  const out = computeJobDurations(timings) as Record<string, { seconds: number; conclusion: string }>;
  assert.equal(out.build.seconds, 300);
  assert.equal(out.build.conclusion, "success");
  assert.equal(out["deploy-production"], undefined);
});

test("changeTypes：按 deployment-plan 归纳变更类型，空则文档/其他", () => {
  assert.deepEqual(changeTypes({ uiChanged: true, codeChanged: true, changedPaths: ["src/app/api/x/route.ts", "src/app/(erp)/y/page.tsx"] }).sort(), ["UI", "业务逻辑", "API"].sort());
  assert.deepEqual(changeTypes({ prismaMigrationChanged: true, workerChanged: true, deploymentChanged: true }), ["数据库", "Worker", "部署底层"]);
  assert.deepEqual(changeTypes({ changedPaths: [] }), ["文档/其他"]);
});

test("parseDeployConsole + buildReport：从真实结构日志生成完整报告", () => {
  const log = [
    "[deploy 02:43:27] 上传发布脚本 -> host",
    "[deploy 02:43:32] 上传发布产物 (31M) -> host",
    "[deploy 02:43:45] 服务器端原子发布与验收开始",
    "当前生产版本:",
    '{"commit":"OLD","appVersion":"v0.0.114"}',
    '{"status":"passed","releaseId":"r1","commit":"NEW","runtimeReleaseVerified":true,"health":"passed","migration":"skipped","rollback":{"status":"not_needed","database":"not_rolled_back"},"services":{"amazon-web":"active","postgres":"running","redis":"running"},"diskAvailableKb":6500000}',
    "[deploy 02:45:02] 服务器端发布完成",
  ].join("\n");
  const parsed = parseDeployConsole(log);
  assert.equal(parsed.stages.length, 4);
  assert.equal(parsed.result.commit, "NEW");
  const report = buildReport({
    manifest: { commit: "NEW", branch: "feat/x", testTier: "fast", testScope: 12, artifactSize: 32000000, artifactSha256: "abc" },
    plan: { uiChanged: true, changedPaths: ["src/app/(erp)/x/page.tsx"] },
    timings: { jobs: [] },
    consoleText: log,
  });
  assert.equal(report.version.commit, "NEW");
  assert.equal(report.verification.status, "passed");
  assert.equal(report.verification.runtimeVerified, "是");
  assert.equal(report.rollback.status, "not_needed");
  assert.equal(report.rollback.database, "not_rolled_back");
  const md = toMarkdown(report);
  assert.match(md, /ERP 生产部署报告/);
  assert.match(md, /✅ passed/);
  assert.match(md, /数据库永不回滚/);
  assert.match(md, /上传产物（跨境传输）：13s/);
});

test("workflow：deploy job 具备自动报告三件套（日志捕获/耗时采集/报告 step）", () => {
  const wf = read(".github/workflows/ci-cd.yml");
  assert.ok(/tee dist\/deploy-console\.log/.test(wf), "deploy 日志需捕获供报告解析");
  assert.ok(/set -o pipefail/.test(wf), "tee 管道必须保留 deploy 失败退出码");
  assert.ok(/ci-job-timings\.json/.test(wf), "需采集 CI job 耗时");
  assert.match(wf, /name: Generate deployment report/);
  assert.match(wf, /node scripts\/deployment-report\.mjs --output "\$GITHUB_STEP_SUMMARY"/);
});

test("humanDuration：秒/分秒格式化", () => {
  assert.equal(humanDuration(45), "45s");
  assert.equal(humanDuration(95), "1m35s");
  assert.equal(humanDuration(null), "—");
});
