import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deploymentAssetStatus, migrationCatalog, migrationReadiness, productionEndpointStatus } from "../scripts/runtime/production-readiness-lib.mjs";

test("production endpoints model target-host Docker loopback without inventing missing configuration", () => {
  assert.deepEqual(productionEndpointStatus("postgresql://app:secret@127.0.0.1:5432/app", { allowLoopback: true }), {
    ok: true,
    detail: "目标机 Docker loopback",
  });
  assert.equal(productionEndpointStatus("redis://127.0.0.1:6379", { allowLoopback: true }).ok, true);
  assert.deepEqual(productionEndpointStatus(undefined, { allowLoopback: true }), { ok: false, detail: "未配置" });
  assert.equal(productionEndpointStatus("postgresql://db.example:5432/app", { allowLoopback: true }).ok, true);
  assert.equal(productionEndpointStatus("postgresql://127.0.0.1:5432/app")?.ok, false);
  assert.equal(productionEndpointStatus("bad url", { allowLoopback: true })?.ok, false);
});

test("migration catalog requires non-empty SQL in every migration directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "readiness-migrations-"));
  try {
    mkdirSync(path.join(root, "20260101000000_first"));
    mkdirSync(path.join(root, "20260102000000_empty"));
    writeFileSync(path.join(root, "20260101000000_first", "migration.sql"), "CREATE TABLE sample (id int);\n");
    writeFileSync(path.join(root, "20260102000000_empty", "migration.sql"), "  \n");
    assert.deepEqual(migrationCatalog(root), [
      { name: "20260101000000_first", hasSql: true },
      { name: "20260102000000_empty", hasSql: false },
    ]);
    assert.equal(migrationReadiness(root).ready, false);
    rmSync(path.join(root, "20260102000000_empty", "migration.sql"));
    assert.equal(migrationReadiness(root).ready, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deploy gate in empty process environment remains fail-closed and performs no DB IO", () => {
  const result = spawnSync(process.execPath, ["scripts/runtime/production-readiness.mjs", "--env", "process", "--gate", "deploy", "--json"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "", HOME: os.homedir(), NODE_ENV: "production" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout) as { ready: boolean; checks: Array<{ id: string; ok: boolean }> };
  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check: { id: string; ok: boolean }) => check.id === "config.env_source")?.ok ?? null, false);
  assert.equal(report.checks.find((check: { id: string; ok: boolean }) => check.id === "secret.auth")?.ok ?? null, false);
  assert.equal(report.checks.find((check: { id: string; ok: boolean }) => check.id === "secret.amazon_sp_api_encryption_key")?.ok ?? null, false);
  assert.equal(report.checks.find(check => check.id === "db.connect"), undefined);
  assert.equal(report.checks.find(check => check.id === "config.database_remote"), undefined);
});

test("deployment assets must exist and contain content", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "readiness-assets-"));
  try {
    writeFileSync(path.join(root, "unit.service"), "\n");
    assert.equal(deploymentAssetStatus(root, ["unit.service"]), false);
    writeFileSync(path.join(root, "unit.service"), "[Service]\nExecStart=/usr/bin/node app.js\n");
    assert.equal(deploymentAssetStatus(root, ["unit.service"]), true);
    assert.equal(deploymentAssetStatus(root, ["missing.service"]), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
