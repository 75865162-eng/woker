// Disposable Docker fixtures only. Never loads .env or inherits credentials.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { randomUUID, scryptSync } from "node:crypto";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { restoreNextEnvironment } from "./runtime/generated-types-cleanup.mjs";
import { backupDatabase } from "./runtime/backup-postgres.mjs";
import { assertFixtureContainer } from "./runtime/fixture-safety.mjs";
import { migrationCatalog, migrationReadiness } from "./runtime/readiness-contract.mjs";
const { Client } = createRequire(import.meta.url)("pg");
const XLSX = createRequire(import.meta.url)("xlsx");
const root = process.cwd(), tag = randomUUID().slice(0, 8);
const workerRegistry = JSON.parse(readFileSync(path.join(root, "src/lib/runtime/worker-registry.json"), "utf8"));
const directory = mkdtempSync(path.join(tmpdir(), "erp-runtime-integration-"));
const pgName = `erp-runtime-pg-${tag}`, redisName = `erp-runtime-redis-${tag}`;
const dist = `.next-dev-runtime-${tag}`;
const containers = [], children = [];
let pgPort, redisPort, pgContainerId;
const pgFixture = { name: pgName, port: null, servicePort: 5432, id: null };
const redisFixture = { name: redisName, port: null, servicePort: 6379, id: null };
const baselineTsconfig = readFileSync(path.join(root, "tsconfig.json"), "utf8");
const baselineNextEnv = existsSync(path.join(root, "next-env.d.ts")) ? readFileSync(path.join(root, "next-env.d.ts"), "utf8") : "";
let browser;
const logFd = openSync(path.join(directory, "fixture.log"), "w", 0o600);
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function verifyFixture(fixture) {
  assert.ok(fixture.id, `fixture ${fixture.name} has no recorded container ID`);
  const inspected = JSON.parse(docker(["inspect", fixture.id]))[0];
  assertFixtureContainer(inspected, { id: fixture.id, name: fixture.name, tag, port: fixture.port, servicePort: fixture.servicePort });
  return inspected;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { try { const value = await fn(); if (value) return value; } catch { /* Disposable dependency starting/reconnecting. */ } await pause(500); }
  throw new Error(`Fixture timeout: ${label}`);
}
function start(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ["ignore", logFd, logFd] });
  children.push(child); return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    // A fixture manager may have been deliberately SIGKILLed; clean only its group.
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    return;
  }
  await new Promise(resolve => {
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve(); }, 28_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}
async function sql(connection, statement, values = []) {
  const client = new Client({ connectionString: connection, connectionTimeoutMillis: 2000 });
  try { await client.connect(); return await client.query(statement, values); }
  finally { await client.end().catch(() => {}); }
}
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
const results = [];
try {
  docker(["image", "inspect", "postgres:16-alpine"]); docker(["image", "inspect", "redis:7"]);
  pgPort = String(await freePort()); redisPort = String(await freePort());
  pgFixture.port = pgPort; redisFixture.port = redisPort;
  pgFixture.id = docker(["run", "--pull=never", "-d", "--name", pgName, "--label", "codex.task=erp-runtime-fixture", "--label", `erp.fixture.run=${tag}`, "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fixture_password", "-e", "POSTGRES_DB=erp_fixture", "-p", `127.0.0.1:${pgPort}:5432`, "postgres:16-alpine"]);
  containers.push(pgFixture);
  redisFixture.id = docker(["run", "--pull=never", "-d", "--name", redisName, "--label", "codex.task=erp-runtime-fixture", "--label", `erp.fixture.run=${tag}`, "--memory=128m", "--cpus=0.5", "-p", `127.0.0.1:${redisPort}:6379`, "redis:7", "redis-server", "--save", "", "--appendonly", "no"]);
  containers.push(redisFixture);
  pgContainerId = pgFixture.id;
  verifyFixture(pgFixture); verifyFixture(redisFixture);
  assert.ok(docker(["port", pgFixture.id, "5432"]).endsWith(":" + pgPort));
  assert.ok(docker(["port", redisFixture.id, "6379"]).endsWith(":" + redisPort));
  const env = {
    PATH: process.env.PATH, TMPDIR: tmpdir(), ERP_RUNTIME_MODE: "production", NODE_ENV: "development", __NEXT_PROCESSED_ENV: "true",
    DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${pgPort}/erp_fixture`, REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    QUEUE_DRIVER: "redis", STORAGE_DRIVER: "local", UPLOAD_DIR: path.join(directory, "uploads"),
    AUTH_DRIVER: "database", AUTH_SECRET: "isolated-runtime-fixture-secret-at-least-32-characters", NEXT_TELEMETRY_DISABLED: "1",
    AMAZON_DATA_CENTER_ENVIRONMENT: "local", AMAZON_SYNC_CENTER_SCOPES: JSON.stringify([["fixture-org", "default"]]),
    AMAZON_FBA_REMOTE_EXECUTION_ENABLED: "false",
  };
  await until(() => sql(env.DATABASE_URL, "SELECT 1"), "PostgreSQL ready");
  const config = path.join(directory, "prisma.config.ts");
  const migrationsRoot = path.join(root, "prisma/migrations");
  writeFileSync(config, `import { defineConfig } from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))}; export default defineConfig({ schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: {path: ${JSON.stringify(migrationsRoot)}}, datasource: {url: ${JSON.stringify(env.DATABASE_URL)}} });`);
  // Prisma CLI may auto-load cwd/.env; launch from the disposable directory.
  const migrate = () => execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", config], { cwd: directory, env, stdio: ["ignore", logFd, logFd] });
  migrate();
  const historySql = 'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at, id';
  const firstHistory = (await sql(env.DATABASE_URL, historySql)).rows;
  const migrationStatus = migrationReadiness(migrationCatalog(migrationsRoot), firstHistory);
  assert.equal(migrationStatus.ok, true, migrationStatus.detail);
  migrate();
  assert.deepEqual((await sql(env.DATABASE_URL, historySql)).rows, firstHistory, "repeat migrate deploy must not change applied history");
  results.push("complete repository migration chain applied to empty disposable PostgreSQL; checksums verified and repeat deploy is idempotent");
  const passwordHash = `scrypt:fixture:${scryptSync("fixture_password", "fixture", 64).toString("base64url")}`;
  await sql(env.DATABASE_URL, `INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ('fixture-org','Fixture','runtime-fixture',now());
    INSERT INTO "WorkspaceScope" ("organizationId",id,name,"isDefault","updatedAt") VALUES ('fixture-org','default','Fixture',true,now());
    INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ('fixture-user','fixture@example.invalid','Fixture','placeholder',now()), ('fixture-operations-user','operations@example.invalid','Fixture Operations','placeholder',now());
    INSERT INTO "OrganizationMember" (id,"organizationId","userId",role,"updatedAt") VALUES ('fixture-member','fixture-org','fixture-user','owner',now()), ('fixture-operations-member','fixture-org','fixture-operations-user','operations',now());`);
  await sql(env.DATABASE_URL, `UPDATE "User" SET "passwordHash"=$1 WHERE id IN ('fixture-user','fixture-operations-user')`, [passwordHash]);
  const fixtureSellerId = "fixture-seller", fixtureMarketplaceId = "ATVPDKIKX0DER";
  await sql(env.DATABASE_URL, `INSERT INTO "SellerAccount" (id,"organizationId","workspaceId","accountKey","displayName","marketplaceCode",status,"updatedAt") VALUES ('fixture-seller','fixture-org','default','runtime-fixture','Runtime Fixture Store','US','active',now());
    INSERT INTO "AmazonSpApiAuthorization" (id,"organizationId","workspaceId",name,"amazonSellerId","awsRegion",endpoint,"credentialsCiphertext",status,"identityVerifiedAt","updatedByUserId","updatedAt") VALUES ('fixture-auth','fixture-org','default','Runtime Fixture','fixture-seller-id','us-east-1','https://example.invalid','unusable-fixture-not-encrypted-credentials','CONFIGURED',now(),'fixture-user',now());
    INSERT INTO "AmazonDataAccessGrant" (id,"organizationId","workspaceId","userId","sellerAccountId",enabled,"marketplaceIds",actions,"updatedAt") VALUES ('fixture-view-grant','fixture-org','default','fixture-user','fixture-seller',true,ARRAY['ATVPDKIKX0DER'],ARRAY['view'],now());
    INSERT INTO "AmazonSyncDataSource" (id,"organizationId","workspaceId","authorizationId","sellerAccountId","marketplaceId",resource,enabled,"freshnessMinutes","updatedAt") VALUES ('fixture-source','fixture-org','default','fixture-auth','fixture-seller','ATVPDKIKX0DER','inventory',false,60,now());
    INSERT INTO "AmazonSellerIdentity" (id,"organizationId","workspaceId","sellerAccountId","amazonSellerId","marketplaceId",region,"authorizationId","verifiedAt") VALUES ('fixture-identity','fixture-org','default','fixture-seller','fixture-seller-id','ATVPDKIKX0DER','NA','fixture-auth',now());`);
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "--test-reporter=tap", "--test-concurrency=1", "tests/integration/runtime-execution.integration.ts"], { cwd: root, env: { ...env, ERP_RUNTIME_EXECUTION_FIXTURE: "1" }, stdio: ["ignore", logFd, logFd] });
  results.push("durable execution claims, expiry fencing, bounded recovery and mock success publications");
  results.push("import stale publication rejected; final audit failure rolls back file/export/job/success versions");
  results.push("import pre-publication and mock image CPU gates: SIGKILL followed by bounded lease takeover publishes once");
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "--test-reporter=tap", "--test-concurrency=1", "tests/integration/runtime-faults.integration.ts"], {
    cwd: root, env: { ...env, ERP_RUNTIME_EXECUTION_FIXTURE: "1", ERP_RUNTIME_FIXTURE_PG_CONTAINER: pgName, ERP_RUNTIME_FIXTURE_PG_ID: pgContainerId, ERP_RUNTIME_FIXTURE_TAG: tag }, stdio: ["ignore", logFd, logFd],
  });
  results.push("real XLSX parser SIGKILL preserves original Bulk input and recovers to one export");
  results.push("image engine executable SIGKILL rejects partial output; protocol fixture retries successfully");
  results.push("PostgreSQL restart inside final audit rolls back job/file/export/success versions; retry publishes once");
  const server = net.createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const web = start(["scripts/next-run.mjs", dist, "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", String(port)], env);
  await until(async () => (await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 400, "web startup", 120_000);
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "fixture@example.invalid", password: "fixture_password" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  async function health() { const response = await fetch(base + "/api/system/worker-health", { headers: { cookie, "x-workspace-id": "default" }, signal: AbortSignal.timeout(15_000) }); assert.equal(response.status, 200); return response.json(); }
  results.push("isolated dev web and database login started");
  const workerIds = workerRegistry.map(item => item.id);
  const hasAllHealthyWorkers = workers => workers.length === workerIds.length
    && workerIds.every(id => workers.some(item => item.id === id && item.online && item.queueReady && item.connectionMatches === true));
  let manager = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(async () => hasAllHealthyWorkers((await health()).registeredWorkers), "all registered heartbeats and Redis connections", 120_000);
  results.push("all registered Worker processes visible through authenticated health API");
  const duplicate = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(() => duplicate.exitCode !== null, "duplicate manager refused");
  assert.notEqual(duplicate.exitCode, 0);
  assert.equal(hasAllHealthyWorkers((await health()).registeredWorkers), true);
  results.push("duplicate manager refused without stopping the original registered Workers");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addCookies(login.headers.getSetCookie().filter(value => value.startsWith("amazon_bulk_ad_session=")).map(value => { const pair = value.split(";")[0]; const i = pair.indexOf("="); return { name: pair.slice(0,i), value: pair.slice(i+1), domain: "127.0.0.1", path: "/", httpOnly: true, secure: false }; }));
  const page = await context.newPage();
  await page.goto(base + "/settings?tab=operations");
  await page.getByText(workerRegistry.find(worker => worker.id === "import").label, { exact: true }).waitFor();
  assert.equal(await page.getByText("心跳在线", { exact: true }).count(), workerIds.length);
  results.push("real browser settings page renders all registered Worker heartbeats");
  await page.route("**/api/system/worker-health", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture health unavailable" }) }));
  const healthCard = page.locator("div").filter({ has: page.getByText("Redis Worker 运维", { exact: true }) }).filter({ has: page.getByText(workerRegistry.find(worker => worker.id === "import").label, { exact: true }) }).last();
  await healthCard.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("fixture health unavailable", { exact: true }).waitFor();
  assert.equal(await page.getByText(workerRegistry.find(worker => worker.id === "import").label, { exact: true }).count(), 0);
  await page.unroute("**/api/system/worker-health");
  await page.reload();
  await page.getByText(workerRegistry.find(worker => worker.id === "import").label, { exact: true }).waitFor();
  results.push("health fetch failure clears stale online cards; successful refresh restores current state");

  const routePage = await context.newPage();
  const routeMutations = [];
  // RUM Web Vitals 上报（/api/observability/vitals）是只读遥测，不是业务写操作，
  // 由前端埋点自动发出；路由覆盖的「只读」断言只针对业务 API 写入。
  const NON_BUSINESS_WRITE_PATHS = new Set(["/api/observability/vitals"]);
  routePage.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (NON_BUSINESS_WRITE_PATHS.has(pathname)) return;
    if (request.url().startsWith(base + "/api/") && request.method() !== "GET" && request.method() !== "HEAD") routeMutations.push(`${request.method()} ${pathname}`);
  });
  routePage.on("response", async response => {
    if (response.url().includes("/api/operations/sync-center") && new URL(response.url()).searchParams.get("section") === "sources") {
      console.log(`[runtime-fixture sources] ${response.status()} ${await response.text().catch(() => "响应正文不可读")}`);
    }
  });
  await routePage.setViewportSize({ width: 1440, height: 1000 });
  await routePage.goto(base + "/operations");
  // 2026-11 导航重构：二级菜单项不再常驻 <nav>，而是 hover/点击所属板块的
  // 「二级菜单」按钮后，经 portal 渲染到 body 的浮层。点击幂等打开（打开态下不切换为关闭）。
  const openFlyout = async (group) => {
    await routePage.getByRole("button", { name: `${group} 二级菜单`, exact: true }).first().click();
  };
  const clickNavItem = async (group, item) => {
    await openFlyout(group);
    await routePage.getByRole("link", { name: item, exact: true }).first().click();
  };
  await clickNavItem("采购管理", "采购订单");
  await routePage.waitForURL(/\/purchase\/orders$/);
  assert.equal(new URL(routePage.url()).pathname, "/purchase/orders");
  await routePage.reload();
  await routePage.getByRole("heading", { name: "经营中台" }).waitFor();
  await clickNavItem("采购管理", "供应商档案");
  await routePage.waitForURL(/\/purchase\/suppliers$/);
  assert.equal(new URL(routePage.url()).pathname, "/purchase/suppliers");
  await clickNavItem("亚马逊数据", "订单");
  await routePage.waitForURL(/\/amazon\/orders$/);
  assert.equal(new URL(routePage.url()).pathname, "/amazon/orders");
  await clickNavItem("仓库管理", "仓库档案");
  await routePage.waitForURL(/\/wms\/warehouse$/);
  assert.equal(new URL(routePage.url()).pathname, "/wms/warehouse");
  await routePage.getByRole("heading", { name: "公司仓库存" }).waitFor();
  await routePage.reload();
  await clickNavItem("仓库管理", "仓库入库");
  await routePage.waitForURL(/\/wms\/receipts$/);
  assert.equal(new URL(routePage.url()).pathname, "/wms/receipts");
  await routePage.goBack();
  await routePage.waitForURL(/\/wms\/warehouse$/);
  for (const [label, view] of [["FBA 装箱", "fba-boxing"], ["头程物流", "first-mile"]]) {
    const fbaResponse = routePage.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/operations/fba-local-plans" && response.request().method() === "GET"
        && url.searchParams.get("sellerAccountId") === fixtureSellerId && url.searchParams.get("marketplaceId") === fixtureMarketplaceId;
    }, { timeout: 120_000 }).then(response => ({ response }), error => ({ error }));
    await clickNavItem("亚马逊数据", label);
    await routePage.waitForURL(new RegExp(`/amazon/${view}$`));
    assert.equal(new URL(routePage.url()).pathname, `/amazon/${view}`);
    if (view === "fba-boxing") await routePage.screenshot({ path: path.join(directory, "fba-boxing-route-debug.png") });
    await routePage.getByRole("heading", { name: view === "fba-boxing" ? "FBA 装箱与箱规" : label, exact: true, level: 1 }).waitFor();
    await until(async () => await routePage.getByLabel("店铺", { exact: true }).filter({ visible: true }).count() === 1, "FBA 筛选器切页完成", 60_000);
    await routePage.getByLabel("店铺", { exact: true }).filter({ visible: true }).selectOption(fixtureSellerId, { timeout: 60_000 });
    await routePage.getByLabel("站点", { exact: true }).filter({ visible: true }).selectOption(fixtureMarketplaceId, { timeout: 60_000 });
    const fbaReadResult = await fbaResponse;
    if (fbaReadResult.error) throw fbaReadResult.error;
    const fbaRead = fbaReadResult.response;
    assert.equal(fbaRead.status(), 200, await fbaRead.text());
    const fbaWorkbench = routePage.getByRole("region", { name: "FBA 本地计划工作台" });
    await fbaWorkbench.waitFor();
    await fbaWorkbench.getByText("当前店铺和站点暂无本地计划。", { exact: true }).waitFor();
    assert.equal(await fbaWorkbench.getByRole("alert").count(), 0);
    await routePage.getByRole("heading", { name: view === "fba-boxing" ? "FBA 本地装箱" : "FBA 本地发货计划", exact: true }).waitFor();
    assert.equal(await routePage.getByRole("status").filter({ hasText: "布局预览" }).count(), 0);
  }
  await clickNavItem("财务管理", "ERP 费用单");
  await routePage.waitForURL(/\/fin\/expenses$/);
  await routePage.getByTestId("finance-expenses-workbench").waitFor();
  await mkdirSync(path.join(root, "docs/wimoor-integration/ui/screenshots"), { recursive: true });
  await routePage.screenshot({ path: path.join(root, "docs/wimoor-integration/ui/screenshots/app-shell-isolated-routes.png") });
  assert.deepEqual(routeMutations, [], "route coverage must remain read-only");
  results.push("real Next App Router: procurement, suppliers, orders, WMS deep links, refresh/back, local FBA packing/plans and finance expenses; no API writes");
  results.push("real AppShell screenshot captured against disposable fixture database");

  const operationsLogin = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "operations@example.invalid", password: "fixture_password" }) });
  assert.equal(operationsLogin.status, 200);
  const operationsContext = await browser.newContext();
  await operationsContext.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await operationsContext.addCookies(operationsLogin.headers.getSetCookie().filter(value => value.startsWith("amazon_bulk_ad_session=")).map(value => { const pair = value.split(";")[0]; const i = pair.indexOf("="); return { name: pair.slice(0,i), value: pair.slice(i+1), domain: "127.0.0.1", path: "/", httpOnly: true, secure: false }; }));
  const operationsPage = await operationsContext.newPage();
  // Root is now the public brand site; permission navigation lives in the ERP shell.
  await operationsPage.goto(base + "/operations");
  // 二级菜单项经浮层渲染；打开有权限的板块浮层确认可见项存在。
  await operationsPage.getByRole("button", { name: "采购管理 二级菜单", exact: true }).first().click();
  // 首页高频直达/侧栏/抽屉可能同时渲染同名「采购订单」链接；断言目的仅为「存在可见项」，取首个避免 strict-mode 多元素歧义。
  await operationsPage.getByRole("link", { name: "采购订单", exact: true }).first().waitFor();
  // 无 WMS 权限时「仓库管理」一级板块整体被过滤，其二级菜单按钮不应存在。
  assert.equal(await operationsPage.getByRole("button", { name: "仓库管理 二级菜单", exact: true }).count(), 0);
  await operationsPage.goto(base + "/logistics/warehouse?tab=warehouses");
  await operationsPage.waitForURL(/\/forbidden\?from=/);
  await operationsContext.close();
  results.push("real permission snapshot filters WMS navigation for operations role and route guard denies direct WMS access");

  // Submit synthetic invalid bulk through the real upload API. It must be consumed
  // and persist a parse failure, without calling Amazon/Sellfox/AI providers.
  const form = new FormData(); form.set("file", new File(["fixture,only\n1,2"], "fixture.csv", { type: "text/csv" }));
  const response = await fetch(base + "/api/files/upload", { method: "POST", headers: { cookie, "x-workspace-id": "default" }, body: form });
  assert.equal(response.status, 200);
  const uploaded = await response.json();
  await until(async () => (await sql(env.DATABASE_URL, `SELECT status,error FROM "ImportJob" WHERE id=$1`, [uploaded.job.id])).rows[0]?.status === "failed", "synthetic task consumption");
  results.push("real upload API task consumed; invalid fixture persisted expected parse failure");

  const bulk = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bulk, XLSX.utils.aoa_to_sheet([
    ["Entity", "Operation", "Campaign ID", "Ad Group ID", "Keyword ID", "Campaign Name (Informational only)", "Ad Group Name (Informational only)", "Keyword Text", "Match Type", "Bid", "Impressions", "Clicks", "Spend", "Sales", "Orders", "State"],
    ["Keyword", "", "fixture-campaign", "fixture-group", "fixture-keyword", "Fixture Campaign", "Fixture Group", "fixture keyword", "exact", 1, 1000, 30, 30, 0, 0, "enabled"],
  ]), "Sponsored Products Campaigns");
  const bulkBytes = XLSX.write(bulk, { type: "buffer", bookType: "xlsx" });
  const validForm = new FormData();
  validForm.set("file", new File([bulkBytes], "fixture-valid.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const validResponse = await fetch(base + "/api/files/upload", { method: "POST", headers: { cookie, "x-workspace-id": "default" }, body: validForm });
  assert.equal(validResponse.status, 200);
  const validUpload = await validResponse.json();
  const completedBulk = await until(async () => {
    const job = (await sql(env.DATABASE_URL, `SELECT status,error FROM "ImportJob" WHERE id=$1`, [validUpload.job.id])).rows[0];
    return ["done", "failed"].includes(job?.status) ? job : null;
  }, "successful Bulk processing");
  assert.equal(completedBulk.status, "done", completedBulk.error ?? "Valid Bulk fixture failed");
  const download = await fetch(base + `/api/files/${validUpload.job.id}/download`, { headers: { cookie, "x-workspace-id": "default" } });
  assert.equal(download.status, 200);
  const resultWorkbook = XLSX.read(await download.arrayBuffer(), { type: "array" });
  const resultRow = XLSX.utils.sheet_to_json(resultWorkbook.Sheets["Sponsored Products Campaigns"])[0];
  assert.equal(resultRow.Bid, 0.8); assert.equal(resultRow.Operation, "Update");
  assert.equal(resultRow["Keyword ID"], "fixture-keyword"); assert.equal(resultRow.State, "enabled");
  assert.deepEqual(readFileSync(path.join(directory, "uploads", validUpload.job.file.storageKey)), bulkBytes);
  assert.equal((await sql(env.DATABASE_URL, `SELECT count(*)::int AS n FROM "ExportRecord" WHERE "jobId"=$1`, [validUpload.job.id])).rows[0].n, 1);
  results.push("valid Bulk upload → real Worker → done → authenticated download; bid updated, identity/input preserved, one export");
  await stop(manager);
  const stoppedWorkers = (await health()).registeredWorkers;
  assert.equal(stoppedWorkers.length, workerIds.length);
  assert.equal(stoppedWorkers.every(item => !item.online), true);
  await page.reload();
  await page.getByText("离线 / 未启动", { exact: true }).first().waitFor();
  assert.equal(await page.getByText("离线 / 未启动", { exact: true }).count(), workerIds.length);
  results.push("graceful stop makes all registered Workers offline");
  manager = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(async () => {
    const workers = (await health()).registeredWorkers;
    return workers.length === workerIds.length && workers.every(item => workerIds.includes(item.id) && item.online);
  }, "Worker restart");
  results.push("Worker restart restores all registered heartbeats");
  const childPids = (await sql(env.DATABASE_URL, `SELECT metadata->>'pid' AS pid FROM "WorkerHeartbeat" WHERE status='online'`)).rows.map(row => Number(row.pid));
  assert.equal(childPids.length, workerIds.length);
  manager.kill("SIGKILL");
  await until(() => childPids.every(pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code !== "ESRCH") throw error; return true; } }), "no orphan Workers after manager SIGKILL", 40_000);
  const killedWorkers = (await health()).registeredWorkers;
  assert.equal(killedWorkers.length, workerIds.length);
  assert.equal(killedWorkers.every(item => !item.online), true);
  results.push("manager SIGKILL: all owned Worker processes terminate without orphans");

  // Flush/restart only this newly created Redis. No business/real queues touched.
  await stop(manager);
  verifyFixture(redisFixture);
  docker(["stop", redisFixture.id]);
  const deferredForm = new FormData(); deferredForm.set("file", new File(["fixture,queued\n1,2"], "deferred.csv", { type: "text/csv" }));
  const deferredResponse = await fetch(base + "/api/files/upload", { method: "POST", headers: { cookie, "x-workspace-id": "default" }, body: deferredForm, signal: AbortSignal.timeout(10_000) });
  assert.equal(deferredResponse.status, 200);
  const deferred = await deferredResponse.json();
  assert.equal(deferred.dispatchDeferred, true); assert.equal(deferred.job.status, "queued");
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WYAAAAAASUVORK5CYII=", "base64");
  const imageForm = new FormData(); imageForm.set("files", new File([imageBytes], "fixture.png", { type: "image/png" }));
  const imageResponse = await fetch(base + "/api/image-upscale", { method: "POST", headers: { cookie, "x-workspace-id": "default" }, body: imageForm, signal: AbortSignal.timeout(10_000) });
  assert.equal(imageResponse.status, 202);
  const imageBatch = await imageResponse.json(); const image = imageBatch.jobs[0];
  assert.equal(imageBatch.dispatchDeferred, true);
  assert.equal((await sql(env.DATABASE_URL, `SELECT status FROM "ImageUpscaleJob" WHERE id=$1`, [image.id])).rows[0].status, "queued");
  assert.deepEqual(readFileSync(path.join(directory, "uploads", image.inputKey)), imageBytes);
  assert.ok(readFileSync(path.join(directory, "uploads", deferred.job.file.storageKey)).length > 0);
  results.push("Redis outage: upload and image APIs retain queued database intent and original input files");
  verifyFixture(redisFixture);
  docker(["start", redisFixture.id]);
  await until(() => docker(["exec", redisFixture.id, "redis-cli", "PING"]) === "PONG", "fixture Redis restart");
  verifyFixture(redisFixture);
  docker(["exec", redisFixture.id, "redis-cli", "FLUSHALL"]);
  verifyFixture(redisFixture);
  docker(["restart", redisFixture.id]);
  await sql(env.DATABASE_URL, `UPDATE "ImportJob" SET status='queued',error=NULL WHERE id=$1`, [uploaded.job.id]);
  manager = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(async () => (await sql(env.DATABASE_URL, `SELECT status FROM "ImportJob" WHERE id=$1`, [uploaded.job.id])).rows[0]?.status === "failed", "recovery from database after Redis data loss");
  results.push("Redis restart + queue loss: database queued intent recovered and consumed");
  await until(async () => (await sql(env.DATABASE_URL, `SELECT status FROM "ImportJob" WHERE id=$1`, [deferred.job.id])).rows[0]?.status === "failed", "deferred bulk recovered");
  await until(async () => ["completed", "failed"].includes((await sql(env.DATABASE_URL, `SELECT status FROM "ImageUpscaleJob" WHERE id=$1`, [image.id])).rows[0]?.status), "deferred image recovered");
  assert.deepEqual(readFileSync(path.join(directory, "uploads", image.inputKey)), imageBytes);
  results.push("connection recovery consumes both deferred jobs with original image input intact");
  const databaseRestartedAt = Date.now();
  verifyFixture(pgFixture);
  docker(["restart", pgFixture.id]);
  await until(() => sql(env.DATABASE_URL, "SELECT 1"), "PostgreSQL restarted");
  await until(async () => {
    const workers = (await health()).registeredWorkers;
    return workers.length === workerIds.length && workers.every(item => workerIds.includes(item.id) && item.online && item.queueReady && new Date(item.lastSeenAt).getTime() > databaseRestartedAt);
  }, "database reconnect", 120_000);
  results.push("PostgreSQL restart: web and all Worker heartbeats reconnect");
  const backup = await backupDatabase({ directory: path.join(directory, "backups"), env, run: async (command, args) => {
    if (command === "pg_dump") writeFileSync(args.at(-1), execFileSync("docker", ["exec", pgFixture.id, "pg_dump", "-U", "postgres", "-d", "erp_fixture", "--format=custom"], { maxBuffer: 16 * 1024 * 1024 }));
    else execFileSync("docker", ["exec", "-i", pgFixture.id, "pg_restore", "--list"], { input: readFileSync(args.at(-1)), stdio: ["pipe", "ignore", "pipe"] });
  } });
  await sql(env.DATABASE_URL, "CREATE DATABASE fixture_restore");
  execFileSync("docker", ["exec", "-i", pgFixture.id, "pg_restore", "-U", "postgres", "--dbname=fixture_restore", "--exit-on-error"], { input: readFileSync(path.join(directory, "backups", backup.filename)), stdio: ["pipe", "ignore", "pipe"] });
  assert.equal((await sql(env.DATABASE_URL.replace("/erp_fixture", "/fixture_restore"), `SELECT count(*)::int AS n FROM "WorkerHeartbeat"`)).rows[0].n > 0, true);
  results.push("fixture PostgreSQL custom backup verified and restored into a separate disposable database");
  await browser.close(); browser = null;
  await stop(manager); await stop(web);
  console.log(JSON.stringify({ fixtureOnly: true, executionTests: { passed: 12, todo: 0 }, results, notCovered: ["native Real-ESRGAN GPU computation (executable protocol fixture tested; native engine not installed)", "real provider calls", "production deployment or reboot", "production backup activation"] }, null, 2));
} catch (error) {
  console.error(`[runtime-fixture] ${error.message}; logs at ${directory}/fixture.log`);
  console.error(`[runtime-fixture] completed checks: ${JSON.stringify(results)}`);
  console.error(readFileSync(path.join(directory, "fixture.log"), "utf8").slice(-24000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const child of children.reverse()) await stop(child);
  let cleanupFailed = false;
  for (const fixture of containers.reverse()) {
    try { verifyFixture(fixture); docker(["rm", "-f", "-v", fixture.id]); }
    catch (error) { cleanupFailed = true; console.error(`[runtime-fixture] refuse cleanup for ${fixture.name}: ${error.message}`); }
  }
  if (cleanupFailed) process.exitCode = 1;
  closeSync(logFd);
  rmSync(path.join(root, dist), { recursive: true, force: true });
  // Next appends a generated types include even when distDir is disposable.
  const configPath = path.join(root, "tsconfig.json");
  const configText = readFileSync(configPath, "utf8");
  const config = JSON.parse(configText);
  config.include = config.include.filter(value => value !== `${dist}/types/**/*.ts`);
  const baseline = JSON.parse(baselineTsconfig);
  const comparable = { ...config, include: [...config.include].sort() };
  const previous = { ...baseline, include: [...baseline.include].sort() };
  // Restore byte-for-byte only if Next made the only edits; preserve concurrent work.
  writeFileSync(configPath, JSON.stringify(comparable) === JSON.stringify(previous) ? baselineTsconfig : JSON.stringify(config, null, 2) + "\n");
  const nextEnvPath = path.join(root, "next-env.d.ts");
  const currentNextEnv = existsSync(nextEnvPath) ? readFileSync(nextEnvPath, "utf8") : "";
  const restoredNextEnv = restoreNextEnvironment(currentNextEnv, baselineNextEnv, dist);
  if (restoredNextEnv !== currentNextEnv) writeFileSync(nextEnvPath, restoredNextEnv);
  if (!process.exitCode) rmSync(directory, { recursive: true, force: true });
}
