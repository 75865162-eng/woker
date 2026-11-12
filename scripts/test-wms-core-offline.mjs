// Creates a labelled disposable PostgreSQL; no root dotenv, inherited credentials or Amazon traffic.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { Client } = createRequire(import.meta.url)("pg");

if (process.argv.slice(2).some(arg => !["--browser"].includes(arg))) throw Error("Supported flags: --browser");
const tag = randomUUID(), name = `wms-core-fixture-${tag}`;
const docker = args => execFileSync("docker", args, { encoding: "utf8", env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] }).trim();
let created = false, db;
try {
  docker(["image", "inspect", "postgres:16-alpine"]);
  docker(["run", "--pull=never", "-d", "--name", name, "--label", `codex.fixture=${tag}`, "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=wms_core_fixture", "-e", "POSTGRES_DB=wms_fixture", "-p", "127.0.0.1::5432", "postgres:16-alpine"]);
  created = true;
  const port = docker(["port", name, "5432/tcp"]);
  assert.match(port, /^127\.0\.0\.1:\d+$/);
  const url = `postgresql://postgres:wms_core_fixture@${port}/wms_fixture`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await candidate.connect(); db = candidate; break; }
    catch { await candidate.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(db, "fixture database ready");
  for (const folder of readdirSync("prisma/migrations").filter(f => /^\d/.test(f)).sort()) {
    if(folder==='20261128010000_wms_transfer_order'){
      await db.query(`INSERT INTO "Organization"(id,name,slug,"updatedAt") VALUES('wms-upgrade-fixture','Synthetic upgrade','wms-upgrade-fixture',NOW());
        INSERT INTO "WorkspaceScope"("organizationId",id,name,"updatedAt") VALUES('wms-upgrade-fixture','default','Synthetic upgrade',NOW());
        INSERT INTO "WmsWarehouse"(id,"organizationId","workspaceId",code,name,"updatedAt") VALUES('wms-upgrade-warehouse','wms-upgrade-fixture','default','PRESERVED','Synthetic preserved warehouse',NOW());
        INSERT INTO "WmsArea"(id,"organizationId","workspaceId","warehouseId",code,name,"updatedAt") VALUES('wms-upgrade-area','wms-upgrade-fixture','default','wms-upgrade-warehouse','A','A',NOW());
        INSERT INTO "WmsLocation"(id,"organizationId","workspaceId","warehouseId","areaId",code,kind,"updatedAt") VALUES('wms-upgrade-location','wms-upgrade-fixture','default','wms-upgrade-warehouse','wms-upgrade-area','S','STORAGE',NOW());`);
    }
    try { await db.query(readFileSync(`prisma/migrations/${folder}/migration.sql`, "utf8")); }
    catch (error) { throw Error(`Fixture migration ${folder}: ${error.message}`); }
  }
  const upgraded=(await db.query(`SELECT w.name,w."typeId",l."lengthCm",l."capacityCubicMeters",l.frozen FROM "WmsWarehouse" w JOIN "WmsLocation" l ON l."warehouseId"=w.id WHERE w.id='wms-upgrade-warehouse'`)).rows[0];
  assert.equal(upgraded.name,'Synthetic preserved warehouse');assert.equal(upgraded.typeId,null);assert.equal(upgraded.lengthCm,null);assert.equal(upgraded.capacityCubicMeters,null);assert.equal(upgraded.frozen,false);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Wms%'`)).rows[0].n,36);
  console.log("PASS: additive upgrades preserve existing warehouse/location rows and create 36 scoped WMS target tables");
  console.log("PASS: full migration chain including additive WMS core tables in an empty disposable database");
  execFileSync(process.execPath, ["--import", "./tests/helpers/wms-process-preload.mjs", "node_modules/tsx/dist/cli.mjs", "tests/integration/wms-core.integration.ts"], {
    env: { PATH: process.env.PATH, DATABASE_URL: url, WMS_OFFLINE_FIXTURE: "1", AUTH_DRIVER: "database", WMS_CORE_BROWSER: process.argv.includes("--browser") ? "1" : "0", AUTH_SECRET: "wms-core-fixture-secret-32-characters" }, stdio: "inherit",
  });
} finally {
  await db?.end().catch(() => {});
  if (created) {
    assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "codex.fixture"}}', name]), tag, "fixture identity required for cleanup");
    docker(["rm", "-f", name]);
  }
}
