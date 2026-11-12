import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");
const flags = process.argv.slice(2);
if (flags.length > 1 || flags.some(flag => !["--inventory-reports", "--promotions-http", "--promotions", "--process-lifecycle", "--finance-parser-recovery", "--finance-history-replay-only", "--automatic-acceptance", "--account-access", "--sales-only", "--sales-pipeline", "--security", "--mcp", "--orders", "--orders-integration-only", "--orders-history-replay-only", "--finance", "--returns", "--returns-history-replay-only", "--domain-reports", "--domain-reports-history-only", "--mfn-returns", "--observations", "--brand", "--offline-all", "--lifecycle"].includes(flag))) throw new Error("Use one documented fixture mode; modes cannot be combined");
const promotionsMode = flags.includes("--promotions") || flags.includes("--promotions-http");
const root = process.cwd(), suffix = randomUUID().slice(0, 8), pgName = `codex-sync-test-pg-${suffix}`, redisName = `codex-sync-test-redis-${suffix}`;
const temporary = await mkdtemp(join(tmpdir(), "amazon-sync-integration-"));
const started = [];
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function run(command, args, env) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: root, env, stdio: "inherit" }); child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); }); }
async function cleanup() { for (const name of started.reverse()) { try { docker(["stop", "--time", "2", name]); } catch { console.error(`Please remove disposable fixture container ${name}`); } } await rm(temporary, { recursive: true, force: true }); }
try {
  // Require preinstalled official images. Never pull images or touch existing containers.
  docker(["image", "inspect", "postgres:16-alpine"]); docker(["image", "inspect", "redis:7"]);
  const bindPort = async () => { const server = net.createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
  const redisBind = flags.includes("--process-lifecycle") ? `127.0.0.1:${await bindPort()}:6379` : "127.0.0.1::6379";
  docker(["run", "--pull=never", "--rm", "-d", "--name", pgName, "--label", "codex.task=amazon-sync-integration", "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fixture_password", "-e", "POSTGRES_DB=amazon_sync_test", "-p", "127.0.0.1::5432", "postgres:16-alpine"]); started.push(pgName);
  docker(["run", "--pull=never", "--rm", "-d", "--name", redisName, "--label", "codex.task=amazon-sync-integration", "--memory=128m", "--cpus=0.5", "-p", redisBind, "redis:7", "redis-server", "--save", "", "--appendonly", "no"]); started.push(redisName);
  const pgPort = docker(["port", pgName, "5432"]).split(":").at(-1), redisPort = docker(["port", redisName, "6379"]).split(":").at(-1);
  // Explicit allowlist: never inherit credentials, private dotenv paths or real DB URLs.
  const env = { PATH: process.env.PATH, TMPDIR: tmpdir(), DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${pgPort}/amazon_sync_test`, REDIS_URL: `redis://127.0.0.1:${redisPort}`, ...(flags.includes("--inventory-reports") ? { QUEUE_DRIVER: "redis" } : {}), AMAZON_SYNC_TEST_REDIS_DISPOSABLE: "1", AMAZON_SYNC_OFFLINE_FIXTURE: "1", AMAZON_API_EXECUTION_ROLE: "cloud", AMAZON_SYNC_BENCHMARK_OUTPUT: join(temporary, "capacity.json"), STORAGE_DRIVER: "local", UPLOAD_DIR: join(temporary, "uploads"), AUTH_DRIVER: "database", AUTH_SECRET: "fixture-only-isolated-integration-secret-2026", AMAZON_DATA_CENTER_ENVIRONMENT: "local" };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { docker(["exec", pgName, "pg_isready", "-U", "postgres"]); ready = true; break; } catch { /* Local readiness probe only; no real test sleeps. */ } }
  if (!ready) throw new Error("Fixture PostgreSQL did not become ready");
  const baseline = join(temporary, "before.prisma");
  // Fixed, audited pre-Phase-1 schema; keeps this migration test reproducible after commits.
  await writeFile(baseline, execFileSync("git", ["show", "cd2be5e5fbad8e67f1e565abe1248927ee135515:prisma/schema.prisma"], { encoding: "utf8" }));
  // Bypass the application's dotenv-loading Prisma config entirely.
  const fixtureConfig = join(temporary, "prisma.config.ts");
  await writeFile(fixtureConfig, `import { defineConfig } from ${JSON.stringify(join(root, "node_modules/prisma/config.js"))}; export default defineConfig({schema:${JSON.stringify(baseline)},migrations:{path:${JSON.stringify(join(temporary, "migrations"))}},datasource:{url:${JSON.stringify(env.DATABASE_URL)}}});`);
  await run(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--config", fixtureConfig], env);
  if (flags.includes("--promotions-http")) {
    await mkdir(join(temporary, "migrations", "00000000000000_fixture_baseline"), { recursive: true });
    await mkdir(join(temporary, "migrations", "20261110010000_amazon_promotions"), { recursive: true });
    await writeFile(join(temporary, "migrations", "migration_lock.toml"), 'provider = "postgresql"\n');
    await writeFile(join(temporary, "migrations", "00000000000000_fixture_baseline", "migration.sql"), "-- Disposable existing baseline.\n");
    await writeFile(join(temporary, "migrations", "20261110010000_amazon_promotions", "migration.sql"), await readFile("prisma/migrations/20261110010000_amazon_promotions/migration.sql", "utf8"));
    env.AMAZON_PROMOTIONS_MIGRATION_CONFIG = fixtureConfig;
  }
  const client = new Client({ connectionString: env.DATABASE_URL }); await client.connect();
  try {
    await client.query(`INSERT INTO "AmazonSyncSchedule" (id,"organizationId","workspaceId",resource,"updatedByUserId","updatedAt") VALUES ('legacy-fixture','legacy-fixture','default','inventory','fixture',now())`);
    await client.query("BEGIN");
    try { for (const migration of ["20261104000000_amazon_sync_center_phase1", "20261104010000_amazon_authorization_validation_state", "20261104020000_amazon_data_center_change_requests", "20261104030000_amazon_sales_traffic_snapshots", "20261105000000_amazon_data_access_grants", "20261105010000_amazon_multistore_mcp", "20261105030000_amazon_orders_incremental", "20261105040000_amazon_order_details", "20261105050000_amazon_finance_transactions", "20261105060000_amazon_returns_reports", "20261105070000_amazon_automatic_sync_schedule_domains", "20261105080000_amazon_domain_report_receivers", "20261105100000_amazon_observation_receivers", "20261105110000_amazon_ads_authorization", "20261105130000_amazon_ads_sync_framework", "20261105140000_amazon_ads_api_budget", "20261105150000_amazon_inventory_events", "20261106000000_amazon_ads_report_versions", "20261106010000_amazon_ads_query_foundation", "20261106020000_amazon_automatic_bound_domains", "20261106030000_amazon_token_account_scope", "20261106040000_amazon_ads_advertiser_account_id", "20261106050000_amazon_catalog_listing_attributes", "20261106060000_amazon_audited_local_recovery", "20261106070000_amazon_settlement_attribution", "20261106170000_runtime_execution_leases", "20261107010000_amazon_catalog_image_assets", "20261107020000_amazon_brand_analytics_collection", "20261107030000_lili_oauth", "20261107050000_amazon_buy_box_automatic", "20261109020000_amazon_field_registry", "20261109030000_amazon_order_fulfillment", "20261110010000_amazon_promotions", "20261110020000_amazon_inventory_reports", "20261111010000_amazon_fba_shipments_report", "20261112010000_amazon_fba_customer_sales_report", "20261112020000_amazon_fba_inventory_by_country", "20261113010000_amazon_mfn_returns_report", "20261113020000_amazon_fba_overage_report", "20261113030000_amazon_fba_fee_preview"]) {
      if (flags.includes("--promotions-http") && migration === "20261110010000_amazon_promotions") {
        await client.query("COMMIT");
        await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "resolve", "--applied", "00000000000000_fixture_baseline", "--config", fixtureConfig], env);
        await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", fixtureConfig], env);
        await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", fixtureConfig], env);
        console.log("PROMOTIONS_MIGRATION fresh initialization, existing baseline upgrade, repeat deploy passed");
        await client.query("BEGIN");
      } else await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"));
    } await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    const result = await client.query(`SELECT "executionVersion","planKey",enabled FROM "AmazonSyncSchedule" WHERE id = 'legacy-fixture'`);
    if (result.rows[0]?.executionVersion !== 1 || result.rows[0]?.planKey !== "legacy" || result.rows[0]?.enabled !== false) throw new Error("Legacy schedule compatibility failed");
    const legacyIndexes = await client.query(`SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('AmazonOrder_seller_id_legacy_key','AmazonFinance_seller_id_legacy_key','AmazonReturn_seller_id_legacy_key')`);
    if (legacyIndexes.rows[0]?.count !== 3) throw new Error("Seller ID indexes required by the previous application release were not retained");
    if (flags.includes("--mcp")) {
      // Exercise destructive DDL only inside this newly-created isolated fixture.
      // Application rollback retains additive OAuth tables and all live grants.
      await client.query("BEGIN");
      try {
        await client.query('DROP TABLE "LiliOAuthRefresh", "LiliOAuthGrant", "LiliOAuthClient"');
        const absent = await client.query("SELECT to_regclass('\"LiliOAuthGrant\"') AS relation");
        if (absent.rows[0]?.relation !== null) throw new Error("OAuth fixture rollback failed");
        await client.query(await readFile("prisma/migrations/20261107030000_lili_oauth/migration.sql", "utf8"));
        const preserved = await client.query('SELECT count(*)::int AS count FROM "AmazonSyncSchedule" WHERE id = $1', ['legacy-fixture']);
        if (preserved.rows[0]?.count !== 1) throw new Error("OAuth migration touched existing business data");
      } finally { await client.query("ROLLBACK"); }
      console.log("OAuth apply/drop/reapply verified in disposable transaction; business sentinel preserved.");
    }
    console.log("Migration applied to disposable fixture; legacy schedule retained and disabled.");
  } finally { await client.end(); }
  if (flags.includes("--promotions-http")) { env.AMAZON_PROMOTIONS_HTTP_FIXTURE = "1"; env.AMAZON_PROMOTIONS_HTTP_EVIDENCE = "/tmp/promotions-http-evidence.json"; }
  const testFile = flags.includes("--inventory-reports") ? "tests/integration/amazon-inventory-reports.integration.ts" : promotionsMode ? "tests/integration/amazon-promotions.integration.ts" : flags.includes("--process-lifecycle") ? "tests/integration/amazon-process-lifecycle.integration.ts" : flags.includes("--automatic-acceptance") ? "tests/integration/amazon-automatic-acceptance.integration.ts" : flags.includes("--account-access") ? "tests/integration/amazon-account-access.integration.ts" : (flags.includes("--observations") || flags.includes("--brand")) ? "tests/integration/amazon-observations.integration.ts" : flags.includes("--lifecycle") ? "tests/integration/amazon-sync-lifecycle.integration.ts" : (flags.includes("--domain-reports") || flags.includes("--domain-reports-history-only") || flags.includes("--mfn-returns")) ? "tests/integration/amazon-domain-reports.integration.ts" : process.argv.includes("--returns") || flags.includes("--returns-history-replay-only") ? "tests/integration/amazon-returns.integration.ts" : (flags.includes("--finance-parser-recovery") || flags.includes("--finance-history-replay-only") || process.argv.includes("--finance")) ? "tests/integration/amazon-finance.integration.ts" : process.argv.includes("--orders") || flags.includes("--orders-integration-only") || flags.includes("--orders-history-replay-only") ? "tests/integration/amazon-orders.integration.ts" : process.argv.includes("--mcp") ? "tests/integration/amazon-mcp.integration.ts" : process.argv.includes("--security") ? "tests/integration/amazon-multistore-security.integration.ts" : process.argv.includes("--sales-pipeline") ? "tests/integration/amazon-sales-pipeline.integration.ts" : flags.includes("--sales-only") ? "tests/integration/amazon-sales-traffic.integration.ts" : "tests/integration/amazon-sync-center.integration.ts";
  if (flags.includes("--process-lifecycle")) { env.ERP_RUNTIME_MODE = "production"; env.AMAZON_SYNC_PROCESS_FIXTURE = "1"; env.QUEUE_DRIVER = "redis"; env.AMAZON_SYNC_FIXTURE_REDIS_CONTAINER = redisName; }
  const integrations = flags.includes("--offline-all") ? ["amazon-sync-lifecycle", "amazon-returns", "amazon-finance", "amazon-orders", "amazon-sync-center", "amazon-sales-traffic", "amazon-sales-pipeline", "amazon-multistore-security", "amazon-mcp", "amazon-domain-reports", "amazon-observations"].map(name => `tests/integration/${name}.integration.ts`) : [testFile];
  if (promotionsMode) await run(process.execPath, ["--import", join(root, "tests/helpers/amazon-offline-network-guard.mjs"), "node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "tests/amazon-promotions.test.ts", "tests/amazon-automatic-policy-matrix.test.ts", "tests/amazon-automatic-schedule.test.ts", "tests/amazon-mcp-registry.test.ts", "tests/amazon-mcp-datasets.test.ts", "tests/amazon-sync-center.test.ts"], env);
  if (!flags.includes("--domain-reports-history-only") && !flags.includes("--orders-integration-only") && !flags.includes("--orders-history-replay-only") && !flags.includes("--returns-history-replay-only") && !flags.includes("--finance-history-replay-only") && ((flags.includes("--observations") || flags.includes("--brand")) || flags.includes("--lifecycle") || flags.includes("--offline-all") || (flags.includes("--domain-reports") || (flags.includes("--orders") || (flags.includes("--finance") || flags.includes("--returns")))))) {
    await run(process.execPath, ["--import", join(root, "tests/helpers/amazon-offline-network-guard.mjs"), "node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "tests/amazon-mainline-continuation.test.ts", "tests/amazon-brand-collection.test.ts", "tests/amazon-observations.test.ts", "tests/amazon-inbound.test.ts", "tests/amazon-returns.test.ts", "tests/amazon-finance.test.ts", "tests/amazon-orders.test.ts", "tests/amazon-domain-reports.test.ts", "tests/amazon-sp-api-client.test.ts", "tests/amazon-sync-center.test.ts", "tests/amazon-automatic-schedule.test.ts", "tests/amazon-report-recovery.test.ts", "tests/amazon-report-archive-recovery.test.ts", "tests/amazon-product-access-recovery.test.ts", "tests/amazon-sales-traffic.test.ts", "tests/amazon-report-lifecycle.test.ts", "tests/amazon-data-center-approval.test.ts", "tests/amazon-authorization-approval.test.ts"], env);
  }
  await run(process.execPath, [...((flags.includes("--inventory-reports") || flags.includes("--mfn-returns") || flags.includes("--finance-parser-recovery") || flags.includes("--finance-history-replay-only") || flags.includes("--automatic-acceptance") || flags.includes("--account-access") || (flags.includes("--observations") || flags.includes("--brand")) || flags.includes("--lifecycle") || flags.includes("--orders") || flags.includes("--orders-integration-only") || flags.includes("--orders-history-replay-only") || flags.includes("--returns-history-replay-only") || (flags.includes("--finance") || flags.includes("--returns"))) || flags.includes("--offline-all") ? ["--import", join(root, "tests/helpers/amazon-offline-network-guard.mjs")] : []), "node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", ...(flags.includes("--brand") ? ["--test-name-pattern=brand"] : []), ...(flags.includes("--mfn-returns") ? ["--test-name-pattern=MFN returns complete"] : []), ...(flags.includes("--finance-parser-recovery") ? ["--test-name-pattern=parser|parse result|parse failure"] : []), ...(flags.includes("--orders-history-replay-only") ? ["--test-name-pattern=Orders internal history replay"] : []), ...(flags.includes("--returns-history-replay-only") ? ["--test-name-pattern=Returns historical window replay|approved retry resets a terminal historical replay"] : []), ...(flags.includes("--finance-history-replay-only") ? ["--test-name-pattern=Finance history replay"] : []), ...(flags.includes("--domain-reports-history-only") ? ["--test-name-pattern=inventory event history replay resumes independently|reimbursement history replay resumes from its task checkpoint"] : []), ...integrations], env);
  if (!flags.includes("--orders-integration-only") && !flags.includes("--orders-history-replay-only") && !flags.includes("--returns-history-replay-only") && !flags.includes("--finance-history-replay-only") && ((flags.includes("--orders") || (flags.includes("--finance") || flags.includes("--returns"))) || flags.includes("--offline-all"))) await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/amazon-orders.config.ts"], env);
  if (!flags.includes("--orders-integration-only") && !flags.includes("--orders-history-replay-only") && !flags.includes("--returns-history-replay-only") && !flags.includes("--finance-history-replay-only") && (flags.includes("--orders") || flags.includes("--offline-all"))) await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/order-fulfillment-recovery.config.ts"], env);
  if (!flags.includes("--returns-history-replay-only") && !flags.includes("--finance-history-replay-only") && ((flags.includes("--finance") || flags.includes("--returns")) || flags.includes("--offline-all"))) await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/amazon-finance.config.ts"], env);
  if (!flags.includes("--returns-history-replay-only") && (flags.includes("--returns") || flags.includes("--offline-all"))) await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/amazon-returns.config.ts"], env);
} finally { await cleanup(); }
