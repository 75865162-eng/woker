/**
 * Read-only production readiness preflight.
 * Never mutates .env, the database, queues or processes.
 *
 * Usage:
 *   npm run check:production                                  # local root .env
 *   npm run check:production -- --gate code                  # internal checks, no DB IO
 *   npm run check:production -- --gate deploy                # package + static assets, no DB IO
 *   npm run check:production -- --env /opt/amazon-ad-bulk-operation/.env  # production EnvironmentFile
 *   npm run check:production -- --env process --gate full    # systemd-injected process.env
 *   npm run check:production -- --json
 *
 * Environment resolution:
 *   --env <path>   parse that EnvironmentFile (file wins over inherited vars)
 *   --env process  use process.env only (what systemd actually injects)
 *   (none)         root .env in local mode; process.env in production mode
 *
 * Exit code 1 when any blocking check in the selected gate fails.
 */
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import { projectRoot } from "./environment.mjs";
import { authReadiness } from "./readiness-contract.mjs";
import { deploymentAssetStatus, encryptionKeyStatus, migrationCatalog, migrationHistoryStatus, productionEndpointStatus, workerHeartbeatStatus } from "./production-readiness-lib.mjs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const asJson = process.argv.includes("--json");
const argValue = (name) => {
  const eq = process.argv.find(arg => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--") ? process.argv[idx + 1] : undefined;
};
const gate = argValue("gate") ?? "full";
if (!["full", "code", "deploy"].includes(gate)) {
  console.error(`--gate must be 'full', 'code' or 'deploy' (got ${gate})`);
  process.exit(2);
}
const checks = [];

// scope: "internal" (repo-verifiable), "asset" (deployment package files),
// "deployment" (needs real external infrastructure / Amazon credentials).
const internalIds = new Set([
  "config.env_source", "config.queue_driver", "secret.auth", "gate.write_disabled",
  "config.storage", "build.standalone", "build.static_assets",
  "db.connect", "db.migrations", "db.clean",
  "secret.amazon_sp_api_encryption_key", "secret.amazon_ads_encryption_key", "secret.sellfox_credential_encryption_key",
]);
const assetIds = new Set([
  // A rendered EnvironmentFile with REPLACE:/GENERATE: leftovers is a package
  // defect, not an external dependency, so --gate deploy must catch it.
  "config.placeholders", "config.auth_origin", "config.tls_verification", "config.database_remote", "config.redis_remote",
  "deploy.env_template", "deploy.runbook", "deploy.systemd_units", "deploy.backup",
  "deploy.tls", "deploy.env_init", "deploy.password_rotation", "deploy.health_endpoint",
  "deploy.csrf_guard", "deploy.amazon_onboarding",
]);
const dbIds = new Set([
  "db.connect", "db.migrations", "db.clean", "amazon.authorization", "amazon.access_grants",
  "amazon.seller_identity", "amazon.sync_sources", "runtime.worker",
]);

/** Only the explicit full gate may touch a database. */
const skipDb = gate !== "full";

function add(id, label, ok, detail, { blocking = true, db = dbIds.has(id) } = {}) {
  const text = detail === undefined || detail === null ? "" : String(detail);
  const skipped = skipDb && db;
  checks.push({
    id,
    label,
    ok: skipped ? true : Boolean(ok),
    detail: skipped ? "SKIP：--gate deploy 不连接数据库" : text,
    blocking: skipped ? false : blocking,
    scope: skipped ? "deployment" : internalIds.has(id) ? "internal" : assetIds.has(id) ? "asset" : "deployment",
  });
}

// --- Environment source -----------------------------------------------------
const explicitEnv = argValue("env");
const productionByInjection = !explicitEnv && process.env.ERP_RUNTIME_MODE === "production";
const source = explicitEnv === "process" ? "process" : explicitEnv ? path.resolve(explicitEnv) : productionByInjection ? "process" : path.join(projectRoot, ".env");
const fromFile = source !== "process";
const fileEnv = fromFile && existsSync(source) ? parseEnv(readFileSync(source, "utf8")) : {};
const env = source === "process" ? { ...process.env } : { ...process.env, ...fileEnv };
add("config.env_source", "环境配置来源可用",
  source === "process" ? Boolean(env.DATABASE_URL) : existsSync(source),
  `source=${source}${productionByInjection ? "（生产模式自动使用 systemd 注入的 process.env）" : ""}`);

const hasPlaceholder = (value) => /^(REPLACE|GENERATE):/.test(String(value ?? "").trim());
const unresolvedKeys = Object.entries(env).filter(([, value]) => hasPlaceholder(value)).map(([key]) => key);

// --- Runtime configuration -------------------------------------------------
const mode = env.ERP_RUNTIME_MODE ?? "local";
add("config.runtime_mode", "ERP_RUNTIME_MODE=production", mode === "production", `当前 ${mode}；production 模式才允许远程数据库/Redis`);
const databaseStatus = productionEndpointStatus(env.DATABASE_URL, { allowLoopback: true, protocols: ["postgres:", "postgresql:"] });
add("config.database_remote", "生产数据库地址符合目标机拓扑", databaseStatus.ok,
  `DATABASE_URL ${databaseStatus.detail}`);
const redisStatus = productionEndpointStatus(env.REDIS_URL, { allowLoopback: true, protocols: ["redis:", "rediss:"] });
add("config.redis_remote", "生产 Redis 地址符合目标机拓扑", redisStatus.ok,
  `REDIS_URL ${redisStatus.detail}`);
add("config.queue_driver", "QUEUE_DRIVER=redis", env.QUEUE_DRIVER === "redis", `当前 ${env.QUEUE_DRIVER ?? "(空)"}；web 与 worker 必须共用持久队列`);
add("config.node_env", "NODE_ENV=production", env.NODE_ENV === "production", `当前 ${env.NODE_ENV ?? "(空)"}`);
add("config.placeholders", "EnvironmentFile 无未填写占位符", unresolvedKeys.length === 0,
  unresolvedKeys.length ? `未填写：${unresolvedKeys.join(", ")}` : "无 REPLACE:/GENERATE: 残留");
add("config.execution_role", "AMAZON_API_EXECUTION_ROLE=cloud", env.AMAZON_API_EXECUTION_ROLE === "cloud",
  `当前 ${env.AMAZON_API_EXECUTION_ROLE ?? "(空)"}；local 会关闭官方 OAuth/读取/报表下载`);
add("config.hsts", "HTTPS 已启用 HSTS 响应头", env.ERP_HSTS_ENABLED === "true",
  `ERP_HSTS_ENABLED=${env.ERP_HSTS_ENABLED ?? "(空)"}；仅在全部域名正确终结 TLS 后开启`, { blocking: false });

const authOrigin = authReadiness(env);
add("config.auth_origin", "认证公开来源与可信代理配置", authOrigin.ok, authOrigin.detail);
add("config.tls_verification", "TLS 证书校验保持启用", env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
  "EnvironmentFile 与当前进程均不得设置 NODE_TLS_REJECT_UNAUTHORIZED=0");

const placeholder = /replace|change-me|example|dev-only|placeholder|your-|REPLACE:/i;
const authSecret = env.AUTH_SECRET ?? "";
add("secret.auth", "AUTH_SECRET 强度", authSecret.length >= 32 && !placeholder.test(authSecret),
  `${authSecret.length} 字符${placeholder.test(authSecret) ? "（模板占位符）" : ""}`);

for (const key of ["AMAZON_SP_API_ENCRYPTION_KEY", "AMAZON_ADS_ENCRYPTION_KEY", "SELLFOX_CREDENTIAL_ENCRYPTION_KEY"]) {
  const status = encryptionKeyStatus(env[key]);
  add(`secret.${key.toLowerCase()}`, `${key} 为 32 字节 Base64 密钥`, status.ok, `${status.bytes} 字节${status.ok ? "" : "；格式无效或未配置"}`);
}

const weakPasswords = new Set(["123", "admin", "password", "123456", "admin123", "test", "test1234"]);
const bootPassword = env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
add("secret.bootstrap_password", "BOOTSTRAP_ADMIN_PASSWORD 非弱口令",
  bootPassword.length >= 12 && !weakPasswords.has(bootPassword.toLowerCase()) && !hasPlaceholder(bootPassword),
  `${bootPassword.length} 字符；当前账号 ${env.BOOTSTRAP_ADMIN_EMAIL ?? "(空)"}`);

add("gate.write_disabled", "Amazon 写执行门禁显式配置",
  env.AMAZON_FBA_REMOTE_EXECUTION_ENABLED === "false" && env.AMAZON_ADS_EXECUTION_ENABLED === "false",
  `FBA=${env.AMAZON_FBA_REMOTE_EXECUTION_ENABLED ?? "(空)"} Ads=${env.AMAZON_ADS_EXECUTION_ENABLED ?? "(空)"}；按当前范围保持 false`);
add("config.storage", "生产文件存储为持久化驱动", env.STORAGE_DRIVER && env.STORAGE_DRIVER !== "local",
  `STORAGE_DRIVER=${env.STORAGE_DRIVER ?? "(默认 local)"}；local 需挂载持久卷或改用 s3/r2`, { blocking: false });

// --- Real Amazon integration ----------------------------------------------
const lwaKeys = ["AMAZON_SP_API_LWA_CLIENT_ID", "AMAZON_SP_API_LWA_CLIENT_SECRET", "AMAZON_SP_API_REFRESH_TOKEN"];
const present = key => { const value = (env[key] ?? "").trim(); return value.length > 0 && !hasPlaceholder(value); };
add("amazon.sp_api_credentials", "SP-API 真实 LWA 凭据", lwaKeys.every(present),
  lwaKeys.map(key => `${key}=${present(key) ? "已配置" : "空/占位符"}`).join(" "));
add("amazon.ads_credentials", "Ads API 真实凭据",
  ["AMAZON_ADS_LWA_CLIENT_ID", "AMAZON_ADS_LWA_CLIENT_SECRET"].every(present),
  "AMAZON_ADS_LWA_CLIENT_ID / AMAZON_ADS_LWA_CLIENT_SECRET");

// --- Build artifact --------------------------------------------------------
const dist = path.join(projectRoot, ".next-build");
const standaloneDist = path.join(dist, "standalone", ".next-build");
add("build.standalone", "standalone 产物完整",
  existsSync(path.join(dist, "standalone", "server.js")) && existsSync(path.join(standaloneDist, "BUILD_ID")),
  ".next-build/standalone/server.js + BUILD_ID");
// start:standalone mirrors these on first launch, so either the mirrored
// copies or their build sources are sufficient evidence of a complete artifact.
const staticReady = existsSync(path.join(standaloneDist, "static")) || existsSync(path.join(dist, "static"));
const publicReady = existsSync(path.join(dist, "standalone", "public")) || existsSync(path.join(projectRoot, "public"));
add("build.static_assets", "standalone 静态资源齐全", staticReady && publicReady,
  `static=${staticReady ? "OK" : "缺失"} public=${publicReady ? "OK" : "缺失"}（start:standalone 会自动补齐）`);

// --- Deployment package ----------------------------------------------------
const asset = (relative) => path.join(projectRoot, relative);
add("deploy.env_template", "生产 EnvironmentFile 模板", deploymentAssetStatus(projectRoot, ["deploy/production.env.example"]), "deploy/production.env.example");
add("deploy.runbook", "生产部署与回滚手册", deploymentAssetStatus(projectRoot, ["deploy/README.md"]), "deploy/README.md");
const registry = JSON.parse(readFileSync(asset("src/lib/runtime/worker-registry.json"), "utf8"));
const registeredServices = registry.map(item => item.service).sort();
const expectedServices = ["amazon-worker", "amazon-image-upscale-worker", "amazon-sync-worker", "amazon-sellfox-sync-worker", "amazon-forecast-worker"].sort();
const unitsReady = registeredServices.length === expectedServices.length && registeredServices.every((name, index) => name === expectedServices[index])
  && expectedServices.every(name => deploymentAssetStatus(projectRoot, [`deploy/systemd/${name}.service`]));
add("deploy.systemd_units", "systemd 单元齐全（web + 5 worker）",
  deploymentAssetStatus(projectRoot, ["deploy/systemd/amazon-web.service"]) && unitsReady,
  "deploy/systemd/*.service 与 worker registry 对齐");
add("deploy.backup", "定时备份与恢复资产",
  deploymentAssetStatus(projectRoot, ["deploy/backup/amazon-postgres-backup.service", "deploy/backup/amazon-postgres-backup.timer", "scripts/runtime/backup-postgres.mjs"]),
  "backup.service + timer + backup-postgres.mjs");
add("deploy.tls", "HTTPS 反向代理配置", deploymentAssetStatus(projectRoot, ["deploy/caddy/Caddyfile"]), "deploy/caddy/Caddyfile");
add("deploy.env_init", "生产密钥生成脚本", deploymentAssetStatus(projectRoot, ["scripts/runtime/production-env-init.mjs"]), "production-env-init.mjs");
add("deploy.password_rotation", "管理员口令轮换脚本", deploymentAssetStatus(projectRoot, ["scripts/runtime/rotate-bootstrap-password.mjs"]), "rotate-bootstrap-password.mjs");
add("deploy.health_endpoint", "公开存活探针", deploymentAssetStatus(projectRoot, ["src/app/api/health/route.ts"]), "/api/health");
add("deploy.csrf_guard", "浏览器 CSRF 防护", deploymentAssetStatus(projectRoot, ["src/lib/auth/csrf.ts"]), "src/lib/auth/csrf.ts");
add("deploy.amazon_onboarding", "Amazon 凭据接入脚本", deploymentAssetStatus(projectRoot, ["scripts/onboard-amazon.mjs"]), "scripts/onboard-amazon.mjs");

// --- Database --------------------------------------------------------------
let client;
try {
  if (skipDb) throw new Error("skipped by --gate deploy");
  client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  await client.connect();
  add("db.connect", "生产数据库可连接", true, "连接成功");

  const history = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations"');
  const migrationsRoot = path.join(projectRoot, "prisma/migrations");
  const migrationStatus = migrationHistoryStatus(migrationCatalog(migrationsRoot), history.rows, migrationsRoot);
  add("db.migrations", "迁移全部应用", migrationStatus.ok, migrationStatus.detail);

  const synthetic = await client.query(`
    SELECT (SELECT count(*) FROM "AmazonSettlementReport" WHERE id LIKE 'e2e-%')
         + (SELECT count(*) FROM "FbaLocalPlan" WHERE id LIKE 'e2e-%')
         + (SELECT count(*) FROM "WmsTransferOrder" WHERE id LIKE 'e2e-%') AS n`);
  add("db.clean", "无本地合成业务数据", Number(synthetic.rows[0].n) === 0, `e2e 行=${synthetic.rows[0].n}`);

  const auths = await client.query(`SELECT count(*)::int AS n FROM "AmazonSpApiAuthorization"
    WHERE status = 'CONFIGURED' AND "identityVerifiedAt" IS NOT NULL`);
  add("amazon.authorization", "存在已验证的 SP-API 授权", auths.rows[0].n > 0, `CONFIGURED 授权=${auths.rows[0].n}`);

  const grants = await client.query('SELECT count(*)::int AS n FROM "AmazonDataAccessGrant" WHERE enabled = true');
  add("amazon.access_grants", "存在用户级数据访问授予", grants.rows[0].n > 0, `启用授予=${grants.rows[0].n}`);

  const identities = await client.query('SELECT count(*)::int AS n FROM "AmazonSellerIdentity"');
  add("amazon.seller_identity", "存在站点身份核实", identities.rows[0].n > 0, `身份=${identities.rows[0].n}`);

  const sources = await client.query('SELECT count(*)::int AS n FROM "AmazonSyncDataSource" WHERE enabled = true');
  add("amazon.sync_sources", "存在启用的同步数据源", sources.rows[0].n > 0, `启用源=${sources.rows[0].n}`);

  // Prisma 将 DateTime 写入 timestamp（无时区）列时统一存 UTC 值；裸 pg 连接的
  // 会话时区可能是 Asia/Shanghai，now()::timestamp 会错 8 小时。显式按 UTC 比较。
  const heartbeats = await client.query(`SELECT "queueName", status, "lastSeenAt" AT TIME ZONE 'UTC' AS "lastSeenAt", metadata FROM "WorkerHeartbeat"
    WHERE "lastSeenAt" >= (now() AT TIME ZONE 'UTC') - interval '90 seconds'
      AND "lastSeenAt" <= (now() AT TIME ZONE 'UTC') + interval '5 seconds'
      AND "queueName" = ANY($1::text[])`, [registry.map(item => item.heartbeatQueue)]);
  const workerStatus = workerHeartbeatStatus(registry, heartbeats.rows);
  add("runtime.worker", "全部注册 Worker 在线且报告队列就绪", workerStatus.ok, workerStatus.detail);
} catch (error) {
  if (!skipDb) add("db.connect", "生产数据库可连接", false, error?.message ?? String(error));
} finally {
  await client?.end().catch(() => {});
}

// --- Output ----------------------------------------------------------------
const scoped = gate === "code" ? checks.filter(row => row.scope === "internal")
  : gate === "deploy" ? checks.filter(row => row.scope === "internal" || row.scope === "asset")
    : checks;
const blockingFailures = scoped.filter(row => !row.ok && row.blocking);
const warnings = scoped.filter(row => !row.ok && !row.blocking);
const skipped = scoped.filter(row => row.detail.startsWith("SKIP："));
const passed = scoped.filter(row => row.ok && !row.detail.startsWith("SKIP："));

if (asJson) {
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(), gate, envSource: source,
    ready: blockingFailures.length === 0, passed: passed.length, skipped: skipped.length,
    blockingFailures, warnings, checks: scoped,
  }, null, 2));
} else {
  console.log(`生产就绪预检  ${new Date().toISOString()}  [gate=${gate}]`);
  console.log(`环境来源      ${source}`);
  console.log("─".repeat(100));
  for (const row of scoped) {
    const mark = row.detail.startsWith("SKIP：") ? "SKIP" : row.ok ? "PASS" : row.blocking ? "FAIL" : "WARN";
    console.log(`[${mark}] ${row.id.padEnd(34)} ${row.label}`);
    console.log(`        ${row.detail}`);
  }
  console.log("─".repeat(100));
  console.log(`通过 ${passed.length} · 跳过 ${skipped.length} · 阻塞 ${blockingFailures.length} · 提示 ${warnings.length}`);
  console.log(gate === "code"
    ? `结论：代码门禁${blockingFailures.length === 0 ? "通过" : "未通过"}；未检查数据库状态，外部接入须另跑 --gate full 并完成真实 Amazon 验收。`
    : gate === "deploy"
      ? `结论：部署清单与静态资产检查${blockingFailures.length === 0 ? "通过" : "未通过"}；不代表部署包完整或生产已就绪，上线前仍须用生产 EnvironmentFile 跑 --gate full。`
      : blockingFailures.length === 0
        ? "结论：配置侧已就绪（仍须完成真实 Amazon 与生产环境验收）。"
        : "结论：未达生产级，须先解决上述 FAIL 项。");
}
process.exitCode = blockingFailures.length === 0 ? 0 : 1;
