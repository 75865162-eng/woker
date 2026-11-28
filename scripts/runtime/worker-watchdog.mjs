/**
 * Worker 看门狗：定时检查所有注册 Worker 的心跳，发现离线/版本陈旧时自动
 * 拉起对应 systemd 服务，并把每次动作写入 WorkerWatchdogEvent 审计表。
 *
 * 由 amazon-worker-watchdog.service + .timer 以 root 身份周期性触发（oneshot）。
 * 只读数据库心跳；只在明确判定故障时执行 systemctl restart；永不改写 .env、
 * 数据库业务数据或 release 文件。判定逻辑见 worker-watchdog-lib.mjs（纯函数）。
 *
 * 防误伤：
 *   - 需要有效性心跳 (online + 90s/5min 窗口) 判定失败才动作；
 *   - 每个 worker 有最小重启间隔，避免起不来的服务被反复重启；
 *   - --dry-run 只判定不动作；--json 输出结构化结果供门禁/测试使用。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import { projectRoot } from "./environment.mjs";
import {
  workerWatchdogDecisions,
  formatWatchdogSummary,
  DEFAULT_STALE_MS,
} from "./worker-watchdog-lib.mjs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
// 与 worker-child.mjs 一致用 createRequire 加载 JSON，避免不同 Node/tsx 版本
// 对 JSON module import attributes 语法支持的差异。
const registry = require("../../src/lib/runtime/worker-registry.json");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};
const dryRun = has("--dry-run");
const asJson = has("--json");
const expectedVersion = valueOf("--expected-version") ?? process.env.ERP_RUNTIME_VERSION ?? null;
const staleMs = Number(valueOf("--stale-ms") ?? process.env.WORKER_WATCHDOG_STALE_MS ?? DEFAULT_STALE_MS);
const minRestartIntervalMs = Number(valueOf("--min-restart-ms") ?? process.env.WORKER_WATCHDOG_RESTART_COOLDOWN_MS ?? 3 * 60_000);

function loadEnv() {
  // 生产由 systemd EnvironmentFile 注入；本地/测试可指定 --env <path>。
  const file = valueOf("--env");
  if (file && existsSync(file)) return parseEnv(readFileSync(file, "utf8"));
  return {};
}

function readLastRestarts() {
  const statePath = path.join(projectRoot, "tmp", "worker-watchdog-last-restart.json");
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function writeLastRestarts(state) {
  const statePath = path.join(projectRoot, "tmp", "worker-watchdog-last-restart.json");
  try {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  } catch { /* best effort: 状态丢失只会导致冷却失效，不影响正确性 */ }
}

async function main() {
  const env = loadEnv();
  const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) {
    const message = "DATABASE_URL 未配置，watchdog 无法读取心跳";
    if (asJson) process.stdout.write(JSON.stringify({ error: message }));
    else console.error(`[worker-watchdog] ${message}`);
    process.exitCode = 1;
    return;
  }

  let client;
  let rows = [];
  try {
    client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 8000 });
    await client.connect();
    // 显式 UTC 比较，避免裸 pg 会话时区与 Prisma 写入的 UTC 值错 8 小时。
    const result = await client.query(
      `SELECT "queueName", status, "lastSeenAt" AT TIME ZONE 'UTC' AS "lastSeenAt", metadata
         FROM "WorkerHeartbeat"
        WHERE "lastSeenAt" >= (now() AT TIME ZONE 'UTC') - interval '10 minutes'
          AND "queueName" = ANY($1::text[])`,
      [registry.map(item => item.heartbeatQueue)],
    );
    rows = result.rows;
  } catch (error) {
    const message = `读取心跳失败：${error?.message ?? String(error)}`;
    if (asJson) process.stdout.write(JSON.stringify({ error: message }));
    else console.error(`[worker-watchdog] ${message}`);
    process.exitCode = 1;
    return;
  } finally {
    await client?.end().catch(() => {});
  }

  const lastRestarts = readLastRestarts();
  const now = Date.now();
  const decisions = workerWatchdogDecisions(registry, rows, {
    now, staleMs, expectedVersion, minRestartIntervalMs, lastRestartAt: lastRestarts,
  });

  const restarted = [];
  const failed = [];
  for (const decision of decisions) {
    if (!decision.shouldRestart) continue;
    if (dryRun) {
      restarted.push({ ...decision, dryRun: true });
      continue;
    }
    try {
      // 子进程：execFile 避免 shell 注入；systemctl 由 root systemd 触发本脚本。
      const { execFileSync } = require("node:child_process");
      execFileSync("systemctl", ["restart", decision.service], { stdio: "ignore", timeout: 30_000 });
      lastRestarts[decision.id] = Date.now();
      restarted.push({ ...decision, action: "RESTARTED" });
      console.error(`[worker-watchdog] 已拉起 ${decision.id} (${decision.service})：${decision.reason}`);
    } catch (error) {
      failed.push({ ...decision, error: error?.message ?? String(error) });
      console.error(`[worker-watchdog] 拉起 ${decision.id} 失败：${error?.message ?? String(error)}`);
    }
  }

  if (Object.keys(lastRestarts).length && !dryRun) writeLastRestarts(lastRestarts);

  const output = {
    at: new Date(now).toISOString(),
    expectedVersion,
    summary: formatWatchdogSummary(decisions),
    decisions,
    restarted,
    failed,
    dryRun,
  };
  if (asJson) process.stdout.write(JSON.stringify(output));
  else console.error(`[worker-watchdog] ${output.summary}；本次拉起 ${restarted.length} 个，失败 ${failed.length} 个`);

  if (failed.length) process.exitCode = 1;
}

await main();
