// Creates a labelled disposable PostgreSQL; no root dotenv, inherited credentials or Amazon traffic.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { Client } = createRequire(import.meta.url)("pg");
const regression = process.argv.includes("--wms-regression");
if (process.argv.slice(2).some(arg => !["--wms-regression", "--browser"].includes(arg))) throw Error("Supported flags: --wms-regression, --browser");
const tag = randomUUID(), name = `fba-local-fixture-${tag}`;
const docker = args => execFileSync("docker", args, { encoding: "utf8", env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] }).trim();
let created = false, db;
try {
  docker(["image", "inspect", "postgres:16-alpine"]);
  docker(["run", "--pull=never", "-d", "--name", name, "--label", `codex.fixture=${tag}`, "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=fba_fixture", "-e", "POSTGRES_DB=wms_fixture", "-p", "127.0.0.1::5432", "postgres:16-alpine"]);
  created = true;
  const port = docker(["port", name, "5432/tcp"]);
  assert.match(port, /^127\.0\.0\.1:\d+$/);
  const url = `postgresql://postgres:fba_fixture@${port}/wms_fixture`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await candidate.connect(); db = candidate; break; }
    catch { await candidate.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(db, "fixture database ready");
  for (const folder of readdirSync("prisma/migrations").filter(f => /^\d/.test(f)).sort()) {
    try { await db.query(readFileSync(`prisma/migrations/${folder}/migration.sql`, "utf8")); }
    catch (error) { throw Error(`Fixture migration ${folder}: ${error.message}`); }
  }
  console.log("PASS: full migration chain including additive FBA plan tables in an empty disposable database");
  execFileSync(process.execPath, ["--import", "./tests/helpers/wms-process-preload.mjs", "node_modules/tsx/dist/cli.mjs", regression ? "tests/integration/wms-first-loop.integration.ts" : "tests/integration/fba-local.integration.ts"], {
    env: { PATH: process.env.PATH, DATABASE_URL: url, WMS_OFFLINE_FIXTURE: "1", AUTH_DRIVER: "database", FBA_BROWSER_FIXTURE: process.argv.includes("--browser") ? "1" : "0", AUTH_SECRET: "fba-isolated-fixture-secret-32-characters" }, stdio: "inherit",
  });
} finally {
  await db?.end().catch(() => {});
  if (created) {
    assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "codex.fixture"}}', name]), tag, "fixture identity required for cleanup");
    docker(["rm", "-f", name]);
  }
}
