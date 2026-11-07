import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// No dotenv, inherited DB URL, image pull, existing container or persistent volume.
if (process.argv.length > 2) throw new Error("This runner accepts no environment or database arguments.");
const root = process.cwd(), target = "20261106010000_amazon_ads_query_foundation";
const name = `codex-ads-migration-${randomUUID().slice(0, 8)}`;
const temp = await mkdtemp(join(tmpdir(), "ads-migration-"));
const docker = (args, input) => execFileSync("docker", args, { encoding: "utf8", input, timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trim();
const sql = (db, text) => docker(["exec", "-i", name, "psql", "-X", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq"], text);
let started = false;

async function migrate(db, expectFailure = false) {
  const config = join(temp, "prisma.config.ts");
  await writeFile(config, `import { defineConfig } from ${JSON.stringify(join(root, "node_modules/prisma/config.js"))}; export default defineConfig({schema:${JSON.stringify(join(temp, "schema.prisma"))},migrations:{path:${JSON.stringify(join(temp, "migrations"))}},datasource:{url:${JSON.stringify(`postgresql://postgres:fixture_password@127.0.0.1:${port}/${db}`)}}});`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", config], {
      cwd: root, env: { PATH: process.env.PATH, TMPDIR: tmpdir(), CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" }, timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject); child.on("exit", code => resolve({ code, output }));
  });
  if (expectFailure) {
    assert.notEqual(result.code, 0, "inconsistent historical rows must block the migration");
    assert.match(result.output, /Amazon Ads rows cross Profile\/task boundaries/);
  } else if (result.code !== 0) {
    // Only synthetic URLs and fixture records exist in this subprocess.
    throw new Error(`Isolated migrate deploy failed:\n${result.output}`);
  }
}
let port;
try {
  docker(["image", "inspect", "postgres:16-alpine"]);
  docker(["run", "--pull=never", "--rm", "-d", "--name", name, "--label", "codex.task=ads-migration-test", "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fixture_password", "-e", "POSTGRES_DB=ads_baseline", "-p", "127.0.0.1::5432", "postgres:16-alpine"]);
  started = true;
  port = docker(["port", name, "5432"]).split(":").at(-1);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker(["exec", name, "pg_isready", "-U", "postgres"]); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, "disposable PostgreSQL must become ready");
  await cp(join(root, "prisma/schema.prisma"), join(temp, "schema.prisma"));
  const migrationRoot = join(root, "prisma/migrations");
  const directories = (await readdir(migrationRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.ok(directories.includes(target));
  // First build the exact previous release using the real SQL chain and Prisma ledger.
  for (const directory of directories.filter(directory => directory < target)) await cp(join(migrationRoot, directory), join(temp, "migrations", directory), { recursive: true });
  await writeFile(join(temp, "migrations/migration_lock.toml"), 'provider = "postgresql"\n');
  await migrate("ads_baseline");
  for (const database of ["ads_empty", "ads_upgrade", "ads_bad_entity", "ads_bad_version", "ads_bad_fact"]) sql("postgres", `CREATE DATABASE ${database} TEMPLATE ads_baseline;`);
  const fixture = await readFile(join(root, "tests/fixtures/amazon-ads-migration.sql"), "utf8");
  for (const database of ["ads_upgrade", "ads_bad_entity", "ads_bad_version", "ads_bad_fact"]) sql(database, fixture);
  sql("ads_bad_entity", `UPDATE "AmazonAdsEntityRecord" SET "profileId"='profile-b';`);
  sql("ads_bad_version", `UPDATE "AmazonAdsReportVersion" SET "profileId"='profile-b';`);
  sql("ads_bad_fact", `UPDATE "AmazonAdsReportFact" SET "profileId"='profile-b';`);
  await cp(join(migrationRoot, target), join(temp, "migrations", target), { recursive: true });
  for (const database of ["ads_empty", "ads_upgrade"]) await migrate(database);
  assert.equal(sql("ads_empty", `SELECT count(*) FROM "_prisma_migrations" WHERE migration_name='${target}' AND finished_at IS NOT NULL;`), "1");
  assert.equal(sql("ads_upgrade", `SELECT "payload"->>'name' FROM "AmazonAdsEntityRecord" WHERE id='entity-a';`), "Legacy fixture");
  assert.equal(sql("ads_upgrade", `SELECT count(*) FROM "AmazonAdsReportFact" WHERE "versionId" IS NULL AND spend=0 AND "currencyCode" IS NULL;`), "1");
  sql("ads_upgrade", `UPDATE "AmazonAdsReportFact" SET orders=NULL, sales=NULL, units=NULL;`);
  assert.equal(sql("ads_upgrade", `SELECT count(*) FROM "AmazonAdsReportFact" WHERE orders IS NULL AND sales IS NULL;`), "2");
  assert.throws(() => sql("ads_upgrade", `UPDATE "AmazonAdsEntityRecord" SET "profileId"='profile-b';`), /AmazonAdsEntityRecord_task_profile_fkey/);
  assert.throws(() => sql("ads_upgrade", `UPDATE "AmazonAdsReportVersion" SET "profileId"='profile-b';`), /AmazonAdsReportVersion_task_profile_fkey/);
  assert.throws(() => sql("ads_upgrade", `UPDATE "AmazonAdsReportFact" SET "profileId"='profile-b' WHERE id='fact-legacy';`), /AmazonAdsReportFact_task_profile_fkey/);
  sql("ads_upgrade", `INSERT INTO "AmazonAdsSyncTask" (id, "organizationId", "planId", "profileId", "requestedByUserId", "idempotencyKey", "planRevision", "updatedAt") VALUES ('second-task', 'org', 'plan', 'profile-a', 'actor', 'second-fixture', 1, now());`);
  assert.throws(() => sql("ads_upgrade", `UPDATE "AmazonAdsReportFact" SET "sourceTaskId"='second-task' WHERE id='fact-version';`), /AmazonAdsReportFact_version_profile_task_fkey/);
  assert.throws(() => sql("ads_upgrade", `INSERT INTO "AmazonAdsReportFact" SELECT 'duplicate', "organizationId", "workspaceId", "profileId", "reportType", "adProduct", "reportDate", "factKey", "campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", placement, impressions, clicks, spend, orders, sales, units, "attributionWindow", "apiVersion", "sourceTaskId", "rawDimensions", "syncedAt", "versionId", "currencyCode" FROM "AmazonAdsReportFact" WHERE id='fact-legacy';`), /AmazonAdsReportFact_legacy_business_key/);
  console.log("PASS: real migration chain, empty installation, legacy-row upgrade, nullable metrics and Profile/idempotency constraints");
  for (const [database, table] of [["ads_bad_entity", "AmazonAdsEntityRecord"], ["ads_bad_version", "AmazonAdsReportVersion"], ["ads_bad_fact", "AmazonAdsReportFact"]]) {
    await migrate(database, true);
    assert.equal(sql(database, `SELECT count(*) FROM "${table}" WHERE "profileId"='profile-b';`), table === "AmazonAdsReportFact" ? "2" : "1");
    console.log(`PASS: ${table} historical Profile mismatch blocks upgrade without reassigning data`);
  }
  console.log("No persistent database migrated; no Amazon API or credentials used.");
} finally {
  if (started) docker(["stop", "--time", "2", name]);
  await rm(temp, { recursive: true, force: true });
}
