import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deploymentAssetStatus, encryptionKeyStatus, migrationCatalog, migrationHistoryStatus, migrationReadiness, productionEndpointStatus } from "../scripts/runtime/production-readiness-lib.mjs";

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

test("encryption key readiness requires canonical Base64 encoding of 32 bytes", () => {
  const valid = Buffer.alloc(32, 7).toString("base64");
  assert.deepEqual(encryptionKeyStatus(valid), { ok: true, bytes: 32 });
  assert.deepEqual(encryptionKeyStatus(Buffer.alloc(31, 7).toString("base64")), { ok: false, bytes: 0 });
  assert.deepEqual(encryptionKeyStatus(`${valid}x`), { ok: false, bytes: 0 });
  assert.deepEqual(encryptionKeyStatus(""), { ok: false, bytes: 0 });
});

test("migration history requires every catalog migration and rejects failed, unknown, or drifted history rows", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "readiness-history-"));
  try {
    const catalog = [{ name: "20260101000000_first", hasSql: true }, { name: "20260102000000_second", hasSql: true }];
    mkdirSync(path.join(root, catalog[0].name));
    mkdirSync(path.join(root, catalog[1].name));
    writeFileSync(path.join(root, catalog[0].name, "migration.sql"), "CREATE TABLE first (id int);\\n");
    writeFileSync(path.join(root, catalog[1].name, "migration.sql"), "CREATE TABLE second (id int);\\n");
    const applied = catalog.map(item => ({ migration_name: item.name, checksum: createHash("sha256").update(readFileSync(path.join(root, item.name, "migration.sql"))).digest("hex"), finished_at: new Date(), rolled_back_at: null, applied_steps_count: 1 }));
    assert.equal(migrationHistoryStatus(catalog, applied, root).ok, true);
    assert.equal(migrationHistoryStatus(catalog, applied.slice(0, 1), root).ok, false);
    assert.equal(migrationHistoryStatus(catalog, [{ ...applied[0], finished_at: null }, applied[1]], root).ok, false);
    assert.equal(migrationHistoryStatus(catalog, [{ ...applied[0], rolled_back_at: new Date() }, applied[1]], root).ok, false);
    const unknown = migrationHistoryStatus(catalog, [...applied, { migration_name: "20300101000000_untracked", checksum: "", finished_at: new Date(), rolled_back_at: null }], root);
    assert.equal(unknown.ok, false);
    assert.match(unknown.detail, /目录外记录=20300101000000_untracked/);
    const drifted = migrationHistoryStatus(catalog, [{ ...applied[0], checksum: "wrong" }, applied[1]], root);
    assert.equal(drifted.ok, false);
    assert.match(drifted.detail, /校验和不匹配=20260101000000_first/);
    assert.equal(migrationHistoryStatus(catalog, [...applied, applied[0]], root).ok, false);
    const noSteps = migrationHistoryStatus(catalog, [{ ...applied[0], applied_steps_count: 0 }, applied[1]], root);
    assert.equal(noSteps.ok, false);
    assert.match(noSteps.detail, /无执行步骤=20260101000000_first/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-full readiness gates skip DB IO while full gate remains explicit", () => {
  for (const gate of ["code", "deploy"]) {
    const result = spawnSync(process.execPath, ["scripts/runtime/production-readiness.mjs", "--env", "process", "--gate", gate, "--json"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", HOME: os.homedir(), NODE_ENV: "production" },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout) as { ready: boolean; checks: Array<{ id: string; ok: boolean; detail: string }> };
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check: { id: string }) => check.id === "config.env_source")?.id ?? null, "config.env_source");
    assert.equal(report.checks.find(check => check.id === "db.connect"), undefined);
    assert.equal(report.checks.find(check => check.id === "db.migrations"), undefined);
  }
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
