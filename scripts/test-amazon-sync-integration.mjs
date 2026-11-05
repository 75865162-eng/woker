import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");
const flags = process.argv.slice(2);
if (flags.length > 1 || flags.some(flag => !["--sales-only", "--sales-pipeline", "--security", "--mcp", "--orders", "--finance", "--returns", "--domain-reports", "--observations", "--offline-all", "--lifecycle"].includes(flag))) throw new Error("Use one documented fixture mode; modes cannot be combined");
const root = process.cwd(), suffix = randomUUID().slice(0, 8), pgName = `codex-sync-test-pg-${suffix}`, redisName = `codex-sync-test-redis-${suffix}`;
const temporary = await mkdtemp(join(tmpdir(), "amazon-sync-integration-"));
const started = [];
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function run(command, args, env) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, env, stdio: "inherit" }); child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); }); }
async function cleanup() { for (const name of started.reverse()) { try { docker(["stop", "--time", "2", name]); } catch { console.error(`Please remove disposable fixture container ${name}`); } } await rm(temporary, { recursive: true, force: true }); }
try {
  // Require preinstalled official images. Never pull images or touch existing containers.
  docker(["image", "inspect", "postgres:16-alpine"]); docker(["image", "inspect", "redis:7"]);
  docker(["run", "--pull=never", "--rm", "-d", "--name", pgName, "--label", "codex.task=amazon-sync-integration", "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fixture_password", "-e", "POSTGRES_DB=amazon_sync_test", "-p", "127.0.0.1::5432", "postgres:16-alpine"]); started.push(pgName);
  docker(["run", "--pull=never", "--rm", "-d", "--name", redisName, "--label", "codex.task=amazon-sync-integration", "--memory=128m", "--cpus=0.5", "-p", "127.0.0.1::6379", "redis:7", "redis-server", "--save", "", "--appendonly", "no"]); started.push(redisName);
  const pgPort = docker(["port", pgName, "5432"]).split(":").at(-1), redisPort = docker(["port", redisName, "6379"]).split(":").at(-1);
  // Explicit allowlist: never inherit credentials, private dotenv paths or real DB URLs.
  const env = { PATH: process.env.PATH, TMPDIR: tmpdir(), DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${pgPort}/amazon_sync_test`, REDIS_URL: `redis://127.0.0.1:${redisPort}`, AMAZON_SYNC_TEST_REDIS_DISPOSABLE: "1", AMAZON_SYNC_OFFLINE_FIXTURE: "1", AMAZON_SYNC_BENCHMARK_OUTPUT: join(temporary, "capacity.json"), STORAGE_DRIVER: "local", UPLOAD_DIR: join(temporary, "uploads"), AUTH_DRIVER: "database", AUTH_SECRET: "fixture-only-isolated-integration-secret-2026", AMAZON_DATA_CENTER_ENVIRONMENT: "local" };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { docker(["exec", pgName, "pg_isready", "-U", "postgres"]); ready = true; break; } catch { /* Local readiness probe only; no real test sleeps. */ } }
  if (!ready) throw new Error("Fixture PostgreSQL did not become ready");
  const baseline = join(temporary, "before.prisma");
  // Fixed, audited pre-Phase-1 schema; keeps this migration test reproducible after commits.
  await writeFile(baseline, execFileSync("git", ["show", "cd2be5e5fbad8e67f1e565abe1248927ee135515:prisma/schema.prisma"], { encoding: "utf8" }));
  // Bypass the application's dotenv-loading Prisma config entirely.
  const fixtureConfig = join(temporary, "prisma.config.ts");
  await writeFile(fixtureConfig, `import { defineConfig } from ${JSON.stringify(join(root, "node_modules/prisma/config.js"))}; export default defineConfig({schema:${JSON.stringify(baseline)},datasource:{url:${JSON.stringify(env.DATABASE_URL)}}});`);
  await run(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--config", fixtureConfig], env);
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  try {
    await client.query(`INSERT INTO "AmazonSyncSchedule" (id,"organizationId","workspaceId",resource,"updatedByUserId","updatedAt") VALUES ('legacy-fixture','legacy-fixture','default','inventory','fixture',now())`);
    await client.query("BEGIN");
    try { for (const migration of ["20261104000000_amazon_sync_center_phase1", "20261104010000_amazon_authorization_validation_state", "20261104020000_amazon_data_center_change_requests", "20261104030000_amazon_sales_traffic_snapshots", "20261105000000_amazon_data_access_grants", "20261105010000_amazon_multistore_mcp", "20261105030000_amazon_orders_incremental", "20261105040000_amazon_order_details", "20261105050000_amazon_finance_transactions", "20261105060000_amazon_returns_reports", "20261105070000_amazon_automatic_sync_schedule_domains", "20261105080000_amazon_domain_report_receivers", "20261105100000_amazon_observation_receivers", "20261105150000_amazon_inventory_events"]) await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8")); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    const result = await client.query(`SELECT "executionVersion","planKey",enabled FROM "AmazonSyncSchedule" WHERE id = 'legacy-fixture'`);
    if (result.rows[0]?.executionVersion !== 1 || result.rows[0]?.planKey !== "legacy" || result.rows[0]?.enabled !== false) throw new Error("Legacy schedule compatibility failed");
    console.log("Migration applied to disposable fixture; legacy schedule retained and disabled.");
  } finally { await client.end(); }
  const testFile = flags.includes("--observations") ? "tests/integration/amazon-observations.integration.ts" : flags.includes("--lifecycle") ? "tests/integration/amazon-sync-lifecycle.integration.ts" : process.argv.includes("--domain-reports") ? "tests/integration/amazon-domain-reports.integration.ts" : process.argv.includes("--returns") ? "tests/integration/amazon-returns.integration.ts" : process.argv.includes("--finance") ? "tests/integration/amazon-finance.integration.ts" : process.argv.includes("--orders") ? "tests/integration/amazon-orders.integration.ts" : process.argv.includes("--mcp") ? "tests/integration/amazon-mcp.integration.ts" : process.argv.includes("--security") ? "tests/integration/amazon-multistore-security.integration.ts" : process.argv.includes("--sales-pipeline") ? "tests/integration/amazon-sales-pipeline.integration.ts" : process.argv.includes("--sales-only") ? "tests/integration/amazon-sales-traffic.integration.ts" : "tests/integration/amazon-sync-center.integration.ts";
  const integrations = flags.includes("--offline-all") ? ["amazon-sync-lifecycle", "amazon-returns", "amazon-finance", "amazon-orders", "amazon-sync-center", "amazon-sales-traffic", "amazon-sales-pipeline", "amazon-multistore-security", "amazon-mcp", "amazon-domain-reports", "amazon-observations"].map(name => `tests/integration/${name}.integration.ts`) : [testFile];
  if (flags.includes("--observations") || flags.includes("--lifecycle") || flags.includes("--offline-all") || (flags.includes("--domain-reports") || (flags.includes("--orders") || (flags.includes("--finance") || flags.includes("--returns"))))) {
    await run(process.execPath, ["--import", join(root, "tests/helpers/amazon-offline-network-guard.mjs"), "node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "tests/amazon-observations.test.ts", "tests/amazon-inbound.test.ts", "tests/amazon-returns.test.ts", "tests/amazon-finance.test.ts", "tests/amazon-orders.test.ts", "tests/amazon-domain-reports.test.ts", "tests/amazon-sp-api-client.test.ts", "tests/amazon-sync-center.test.ts", "tests/amazon-automatic-schedule.test.ts", "tests/amazon-sales-traffic.test.ts", "tests/amazon-report-lifecycle.test.ts", "tests/amazon-data-center-approval.test.ts", "tests/amazon-authorization-approval.test.ts"], env);
  }
  await run(process.execPath, [...((flags.includes("--observations") || flags.includes("--lifecycle") || flags.includes("--orders") || (flags.includes("--finance") || flags.includes("--returns"))) || flags.includes("--offline-all") ? ["--import", join(root, "tests/helpers/amazon-offline-network-guard.mjs")] : []), "node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", ...integrations], env);
  if ((flags.includes("--orders") || (flags.includes("--finance") || flags.includes("--returns"))) || flags.includes("--offline-all")) await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/amazon-orders.config.ts"], env);
  if ((flags.includes("--finance") || flags.includes("--returns")) || flags.includes("--offline-all")) await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/amazon-finance.config.ts"], env);
  if (flags.includes("--returns") || flags.includes("--offline-all")) await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/amazon-returns.config.ts"], env);
} finally { await cleanup(); }
