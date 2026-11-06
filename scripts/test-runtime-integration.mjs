// Disposable Docker fixtures only. Never loads .env or inherits credentials.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { randomUUID, scryptSync } from "node:crypto";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { restoreNextEnvironment } from "./runtime/generated-types-cleanup.mjs";
import { backupDatabase } from "./runtime/backup-postgres.mjs";
const { Client } = createRequire(import.meta.url)("pg");
const XLSX = createRequire(import.meta.url)("xlsx");
const root = process.cwd(), tag = randomUUID().slice(0, 8);
const directory = mkdtempSync(path.join(tmpdir(), "erp-runtime-integration-"));
const pgName = `erp-runtime-pg-${tag}`, redisName = `erp-runtime-redis-${tag}`;
const dist = `.next-dev-runtime-${tag}`;
const containers = [], children = [];
const baselineTsconfig = readFileSync(path.join(root, "tsconfig.json"), "utf8");
const baselineNextEnv = readFileSync(path.join(root, "next-env.d.ts"), "utf8");
let browser;
const logFd = openSync(path.join(directory, "fixture.log"), "w", 0o600);
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  const pgPort = String(await freePort()), redisPort = String(await freePort());
  docker(["run", "--pull=never", "-d", "--name", pgName, "--label", "codex.task=erp-runtime-fixture", "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fixture_password", "-e", "POSTGRES_DB=erp_fixture", "-p", `127.0.0.1:${pgPort}:5432`, "postgres:16-alpine"]); containers.push(pgName);
  docker(["run", "--pull=never", "-d", "--name", redisName, "--label", "codex.task=erp-runtime-fixture", "--memory=128m", "--cpus=0.5", "-p", `127.0.0.1:${redisPort}:6379`, "redis:7", "redis-server", "--save", "", "--appendonly", "no"]); containers.push(redisName);
  assert.ok(docker(["port", pgName, "5432"]).endsWith(":" + pgPort));
  assert.ok(docker(["port", redisName, "6379"]).endsWith(":" + redisPort));
  const env = {
    PATH: process.env.PATH, TMPDIR: tmpdir(), ERP_RUNTIME_MODE: "production", NODE_ENV: "development",
    DATABASE_URL: `postgresql://postgres:fixture_password@127.0.0.1:${pgPort}/erp_fixture`, REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    QUEUE_DRIVER: "redis", STORAGE_DRIVER: "local", UPLOAD_DIR: path.join(directory, "uploads"),
    AUTH_DRIVER: "database", AUTH_SECRET: "isolated-runtime-fixture-secret", NEXT_TELEMETRY_DISABLED: "1",
    AMAZON_DATA_CENTER_ENVIRONMENT: "local", AMAZON_SYNC_CENTER_SCOPES: "[]",
  };
  await until(() => sql(env.DATABASE_URL, "SELECT 1"), "PostgreSQL ready");
  const config = path.join(directory, "prisma.config.ts");
  const beforeLeaseSchema = path.join(directory, "before-leases.prisma");
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const baseline = schema.replace(/model (ImportJob|ImageUpscaleJob) \{[\s\S]*?\n\}/g, block => block.replace(/^  (executionToken|leaseExpiresAt|executionAttempts|maxAttempts) .*\n/gm, "").replace(/^  @@index\(\[status, leaseExpiresAt\]\).*\n/gm, ""));
  writeFileSync(beforeLeaseSchema, baseline);
  writeFileSync(config, `import { defineConfig } from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))}; export default defineConfig({ schema: ${JSON.stringify(beforeLeaseSchema)}, datasource: {url: ${JSON.stringify(env.DATABASE_URL)}} });`);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--config", config], { cwd: root, env, stdio: ["ignore", logFd, logFd] });
  await sql(env.DATABASE_URL, readFileSync(path.join(root, "prisma/migrations/20261106170000_runtime_execution_leases/migration.sql"), "utf8"));
  const passwordHash = `scrypt:fixture:${scryptSync("fixture_password", "fixture", 64).toString("base64url")}`;
  await sql(env.DATABASE_URL, `INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ('fixture-org','Fixture','runtime-fixture',now());
    INSERT INTO "WorkspaceScope" ("organizationId",id,name,"isDefault","updatedAt") VALUES ('fixture-org','default','Fixture',true,now());
    INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ('fixture-user','fixture@example.invalid','Fixture','placeholder',now());
    INSERT INTO "OrganizationMember" (id,"organizationId","userId",role,"updatedAt") VALUES ('fixture-member','fixture-org','fixture-user','owner',now());`);
  await sql(env.DATABASE_URL, `UPDATE "User" SET "passwordHash"=$1 WHERE id='fixture-user'`, [passwordHash]);
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "tests/integration/runtime-execution.integration.ts"], { cwd: root, env: { ...env, ERP_RUNTIME_EXECUTION_FIXTURE: "1" }, stdio: ["ignore", logFd, logFd] });
  results.push("durable execution claims, expiry fencing, bounded recovery and mock success publications");
  results.push("import stale publication rejected; final audit failure rolls back file/export/job/success versions");
  results.push("import pre-publication and mock image CPU gates: SIGKILL followed by bounded lease takeover publishes once");
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "tests/integration/runtime-faults.integration.ts"], {
    cwd: root, env: { ...env, ERP_RUNTIME_EXECUTION_FIXTURE: "1", ERP_RUNTIME_FIXTURE_PG_CONTAINER: pgName }, stdio: ["ignore", logFd, logFd],
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
  async function health() { const response = await fetch(base + "/api/system/worker-health", { headers: { cookie }, signal: AbortSignal.timeout(15_000) }); assert.equal(response.status, 200); return response.json(); }
  results.push("isolated dev web and database login started");
  let manager = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(async () => { const data = await health(); return data.registeredWorkers.length === 4 && data.registeredWorkers.every(item => item.online && item.queueReady && item.connectionMatches === true); }, "all registered heartbeats and Redis connections", 120_000);
  results.push("all four real Worker processes visible through authenticated health API");
  const duplicate = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(() => duplicate.exitCode !== null, "duplicate manager refused");
  assert.notEqual(duplicate.exitCode, 0);
  assert.ok((await health()).registeredWorkers.every(item => item.online));
  results.push("duplicate manager refused without stopping the original four Workers");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addCookies(login.headers.getSetCookie().filter(value => value.startsWith("amazon_bulk_ad_session=")).map(value => { const pair = value.split(";")[0]; const i = pair.indexOf("="); return { name: pair.slice(0,i), value: pair.slice(i+1), domain: "127.0.0.1", path: "/", httpOnly: true, secure: false }; }));
  const page = await context.newPage();
  await page.goto(base + "/settings?tab=operations");
  await page.getByText("文件导入与商品 Outbox", { exact: true }).waitFor();
  assert.equal(await page.getByText("心跳在线", { exact: true }).count() >= 4, true);
  results.push("real browser settings page renders all four registered Worker heartbeats");
  await page.route("**/api/system/worker-health", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture health unavailable" }) }));
  const healthCard = page.locator("div").filter({ has: page.getByText("Redis Worker 运维", { exact: true }) }).filter({ has: page.getByText("文件导入与商品 Outbox", { exact: true }) }).last();
  await healthCard.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("fixture health unavailable", { exact: true }).waitFor();
  assert.equal(await page.getByText("文件导入与商品 Outbox", { exact: true }).count(), 0);
  await page.unroute("**/api/system/worker-health");
  await page.reload();
  await page.getByText("文件导入与商品 Outbox", { exact: true }).waitFor();
  results.push("health fetch failure clears stale online cards; successful refresh restores current state");

  // Submit synthetic invalid bulk through the real upload API. It must be consumed
  // and persist a parse failure, without calling Amazon/Sellfox/AI providers.
  const form = new FormData(); form.set("file", new File(["fixture,only\n1,2"], "fixture.csv", { type: "text/csv" }));
  const response = await fetch(base + "/api/files/upload", { method: "POST", headers: { cookie }, body: form });
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
  const validResponse = await fetch(base + "/api/files/upload", { method: "POST", headers: { cookie }, body: validForm });
  assert.equal(validResponse.status, 200);
  const validUpload = await validResponse.json();
  const completedBulk = await until(async () => {
    const job = (await sql(env.DATABASE_URL, `SELECT status,error FROM "ImportJob" WHERE id=$1`, [validUpload.job.id])).rows[0];
    return ["done", "failed"].includes(job?.status) ? job : null;
  }, "successful Bulk processing");
  assert.equal(completedBulk.status, "done", completedBulk.error ?? "Valid Bulk fixture failed");
  const download = await fetch(base + `/api/files/${validUpload.job.id}/download`, { headers: { cookie } });
  assert.equal(download.status, 200);
  const resultWorkbook = XLSX.read(await download.arrayBuffer(), { type: "array" });
  const resultRow = XLSX.utils.sheet_to_json(resultWorkbook.Sheets["Sponsored Products Campaigns"])[0];
  assert.equal(resultRow.Bid, 0.8); assert.equal(resultRow.Operation, "Update");
  assert.equal(resultRow["Keyword ID"], "fixture-keyword"); assert.equal(resultRow.State, "enabled");
  assert.deepEqual(readFileSync(path.join(directory, "uploads", validUpload.job.file.storageKey)), bulkBytes);
  assert.equal((await sql(env.DATABASE_URL, `SELECT count(*)::int AS n FROM "ExportRecord" WHERE "jobId"=$1`, [validUpload.job.id])).rows[0].n, 1);
  results.push("valid Bulk upload → real Worker → done → authenticated download; bid updated, identity/input preserved, one export");
  await stop(manager);
  assert.ok((await health()).registeredWorkers.every(item => !item.online));
  await page.reload();
  await page.getByText("离线 / 未启动", { exact: true }).first().waitFor();
  assert.equal(await page.getByText("离线 / 未启动", { exact: true }).count(), 4);
  results.push("graceful stop makes all four Workers offline");
  manager = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(async () => (await health()).registeredWorkers.every(item => item.online), "Worker restart");
  results.push("Worker restart restores all registered heartbeats");
  const childPids = (await sql(env.DATABASE_URL, `SELECT metadata->>'pid' AS pid FROM "WorkerHeartbeat" WHERE status='online'`)).rows.map(row => Number(row.pid));
  assert.equal(childPids.length, 4);
  manager.kill("SIGKILL");
  await until(() => childPids.every(pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code !== "ESRCH") throw error; return true; } }), "no orphan Workers after manager SIGKILL", 40_000);
  assert.ok((await health()).registeredWorkers.every(item => !item.online));
  results.push("manager SIGKILL: all owned Worker processes terminate without orphans");

  // Flush/restart only this newly created Redis. No business/real queues touched.
  await stop(manager);
  docker(["stop", redisName]);
  const deferredForm = new FormData(); deferredForm.set("file", new File(["fixture,queued\n1,2"], "deferred.csv", { type: "text/csv" }));
  const deferredResponse = await fetch(base + "/api/files/upload", { method: "POST", headers: { cookie }, body: deferredForm, signal: AbortSignal.timeout(10_000) });
  assert.equal(deferredResponse.status, 200);
  const deferred = await deferredResponse.json();
  assert.equal(deferred.dispatchDeferred, true); assert.equal(deferred.job.status, "queued");
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WYAAAAAASUVORK5CYII=", "base64");
  const imageForm = new FormData(); imageForm.set("files", new File([imageBytes], "fixture.png", { type: "image/png" }));
  const imageResponse = await fetch(base + "/api/image-upscale", { method: "POST", headers: { cookie }, body: imageForm, signal: AbortSignal.timeout(10_000) });
  assert.equal(imageResponse.status, 202);
  const imageBatch = await imageResponse.json(); const image = imageBatch.jobs[0];
  assert.equal(imageBatch.dispatchDeferred, true);
  assert.equal((await sql(env.DATABASE_URL, `SELECT status FROM "ImageUpscaleJob" WHERE id=$1`, [image.id])).rows[0].status, "queued");
  assert.deepEqual(readFileSync(path.join(directory, "uploads", image.inputKey)), imageBytes);
  assert.ok(readFileSync(path.join(directory, "uploads", deferred.job.file.storageKey)).length > 0);
  results.push("Redis outage: upload and image APIs retain queued database intent and original input files");
  docker(["start", redisName]);
  await until(() => docker(["exec", redisName, "redis-cli", "PING"]) === "PONG", "fixture Redis restart");
  docker(["exec", redisName, "redis-cli", "FLUSHALL"]);
  docker(["restart", redisName]);
  await sql(env.DATABASE_URL, `UPDATE "ImportJob" SET status='queued',error=NULL WHERE id=$1`, [uploaded.job.id]);
  manager = start(["scripts/runtime/worker-manager.mjs"], env);
  await until(async () => (await sql(env.DATABASE_URL, `SELECT status FROM "ImportJob" WHERE id=$1`, [uploaded.job.id])).rows[0]?.status === "failed", "recovery from database after Redis data loss");
  results.push("Redis restart + queue loss: database queued intent recovered and consumed");
  await until(async () => (await sql(env.DATABASE_URL, `SELECT status FROM "ImportJob" WHERE id=$1`, [deferred.job.id])).rows[0]?.status === "failed", "deferred bulk recovered");
  await until(async () => ["completed", "failed"].includes((await sql(env.DATABASE_URL, `SELECT status FROM "ImageUpscaleJob" WHERE id=$1`, [image.id])).rows[0]?.status), "deferred image recovered");
  assert.deepEqual(readFileSync(path.join(directory, "uploads", image.inputKey)), imageBytes);
  results.push("connection recovery consumes both deferred jobs with original image input intact");
  const databaseRestartedAt = Date.now();
  docker(["restart", pgName]);
  await until(() => sql(env.DATABASE_URL, "SELECT 1"), "PostgreSQL restarted");
  await until(async () => (await health()).registeredWorkers.every(item => item.online && item.queueReady && new Date(item.lastSeenAt).getTime() > databaseRestartedAt), "database reconnect", 120_000);
  results.push("PostgreSQL restart: web and all Worker heartbeats reconnect");
  const backup = await backupDatabase({ directory: path.join(directory, "backups"), env, run: async (command, args) => {
    if (command === "pg_dump") writeFileSync(args.at(-1), execFileSync("docker", ["exec", pgName, "pg_dump", "-U", "postgres", "-d", "erp_fixture", "--format=custom"], { maxBuffer: 16 * 1024 * 1024 }));
    else execFileSync("docker", ["exec", "-i", pgName, "pg_restore", "--list"], { input: readFileSync(args.at(-1)), stdio: ["pipe", "ignore", "pipe"] });
  } });
  await sql(env.DATABASE_URL, "CREATE DATABASE fixture_restore");
  execFileSync("docker", ["exec", "-i", pgName, "pg_restore", "-U", "postgres", "--dbname=fixture_restore", "--exit-on-error"], { input: readFileSync(path.join(directory, "backups", backup.filename)), stdio: ["pipe", "ignore", "pipe"] });
  assert.equal((await sql(env.DATABASE_URL.replace("/erp_fixture", "/fixture_restore"), `SELECT count(*)::int AS n FROM "WorkerHeartbeat"`)).rows[0].n > 0, true);
  results.push("fixture PostgreSQL custom backup verified and restored into a separate disposable database");
  await browser.close(); browser = null;
  await stop(manager); await stop(web);
  console.log(JSON.stringify({ fixtureOnly: true, executionTests: { passed: 12, todo: 0 }, results, notCovered: ["native Real-ESRGAN GPU computation (executable protocol fixture tested; native engine not installed)", "real provider calls", "production deployment or reboot", "production backup activation"] }, null, 2));
} catch (error) {
  console.error(`[runtime-fixture] ${error.message}; logs at ${directory}/fixture.log`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const child of children.reverse()) await stop(child);
  for (const container of containers.reverse()) { try { docker(["rm", "-f", container]); } catch { console.error(`[runtime-fixture] remove disposable container ${container} manually`); } }
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
  const currentNextEnv = readFileSync(nextEnvPath, "utf8");
  const restoredNextEnv = restoreNextEnvironment(currentNextEnv, baselineNextEnv, dist);
  if (restoredNextEnv !== currentNextEnv) writeFileSync(nextEnvPath, restoredNextEnv);
  if (!process.exitCode) rmSync(directory, { recursive: true, force: true });
}
