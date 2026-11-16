import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deploymentAssetStatus, encryptionKeyStatus, migrationCatalog, migrationHistoryStatus, migrationReadiness, productionEndpointStatus, workerHeartbeatStatus } from "../scripts/runtime/production-readiness-lib.mjs";

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
  assert.equal(productionEndpointStatus("https://db.internal", { allowLoopback: true }).ok, false);
  assert.equal(productionEndpointStatus("redis://db.internal", { protocols: ["postgresql:"] }).ok, false);
  assert.equal(productionEndpointStatus("postgresql://db.internal/app", { protocols: ["redis:", "rediss:"] }).ok, false);
});

test("worker readiness requires every registered worker, online timestamps and explicit queue readiness", () => {
  const registry = [{ id: "one", heartbeatQueue: "one" }, { id: "two", heartbeatQueue: "two" }];
  const now = new Date("2026-11-16T08:00:00Z");
  const rows = registry.map(worker => ({ queueName: worker.heartbeatQueue, status: "online", lastSeenAt: now, metadata: { queueReady: true } }));
  assert.equal(workerHeartbeatStatus(registry, rows, now).ok, true);
  assert.equal(workerHeartbeatStatus([], rows, now).ok, false);
  assert.equal(workerHeartbeatStatus(registry, rows.slice(1), now).ok, false);
  for (const status of ["stopped", "stopping", "offline"]) assert.equal(workerHeartbeatStatus(registry, [{ ...rows[0], status }, rows[1]], now).ok, false);
  for (const lastSeenAt of [new Date(now.getTime() - 90_001), new Date(now.getTime() + 5001), new Date("invalid")]) assert.equal(workerHeartbeatStatus(registry, [{ ...rows[0], lastSeenAt }, rows[1]], now).ok, false);
  for (const metadata of [null, {}, { queueReady: false }, { queueReady: "true" }]) assert.equal(workerHeartbeatStatus(registry, [{ ...rows[0], metadata }, rows[1]], now).ok, false);
  assert.equal(workerHeartbeatStatus(registry, [...rows, { ...rows[0], metadata: { queueReady: false } }], now).ok, false);
  assert.equal(workerHeartbeatStatus(registry, [...rows, { ...rows[0], status: "stopped", metadata: {} }], now).ok, true);
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
    assert.equal(migrationHistoryStatus(migrationCatalog(root), [], root).ok, false);
    assert.equal(migrationReadiness(root).ready, false);
    rmSync(path.join(root, "20260102000000_empty", "migration.sql"));
    assert.equal(migrationReadiness(root).ready, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration checks accept LF and CRLF history but reject SQL content changes", async () => {
  const contract = await import("../scripts/runtime/readiness-contract.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "readiness-newlines-"));
  try {
    mkdirSync(path.join(root, "one"));
    const sql = "CREATE TABLE sample (id int);\n";
    writeFileSync(path.join(root, "one/migration.sql"), sql);
    const row = { migration_name: "one", checksum: createHash("sha256").update(sql.replace(/\n/g, "\r\n")).digest("hex"), finished_at: new Date(), rolled_back_at: null, applied_steps_count: 1 };
    assert.equal(contract.migrationReadiness(contract.migrationCatalog(root), [row]).ok, true);
    assert.equal(migrationHistoryStatus(migrationCatalog(root), [row], root).ok, true);
    writeFileSync(path.join(root, "one/migration.sql"), sql.replace("int", "text"));
    assert.equal(contract.migrationReadiness(contract.migrationCatalog(root), [row]).ok, false);
    assert.equal(migrationHistoryStatus(migrationCatalog(root), [row], root).ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
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
    const missingSqlCatalog = catalog.map((item, index) => index === 1 ? { ...item, hasSql: false } : item);
    writeFileSync(path.join(root, catalog[1].name, "migration.sql"), "  \n");
    assert.equal(migrationHistoryStatus(missingSqlCatalog, applied, root).ok, false, "empty SQL blocks even with completed history");
    writeFileSync(path.join(root, catalog[1].name, "migration.sql"), "CREATE TABLE second (id int);\\n");
    assert.equal(migrationHistoryStatus(catalog.slice(0, 1), applied.slice(0, 1), root).ok, true);
    assert.equal(migrationHistoryStatus([], [], root).ok, false, "empty catalog must block readiness");
    assert.equal(migrationHistoryStatus(catalog.slice(0, 1), [{ ...applied[0], applied_steps_count: undefined }], root).ok, false, "missing applied step count must block readiness");
    assert.equal(migrationHistoryStatus(catalog.slice(0, 1), [{ ...applied[0], applied_steps_count: "invalid" }], root).ok, false, "invalid applied step count must block readiness");
    assert.equal(migrationHistoryStatus(catalog, applied.slice(0, 1), root).ok, false);
    assert.equal(migrationHistoryStatus(catalog, [{ ...applied[0], finished_at: null }, applied[1]], root).ok, false);
    assert.equal(migrationHistoryStatus(catalog, [{ ...applied[0], rolled_back_at: new Date() }, applied[1]], root).ok, false);
    assert.equal(migrationHistoryStatus(catalog, [{ ...applied[0], finished_at: null, rolled_back_at: new Date() }, ...applied], root).ok, true, "rolled-back attempt followed by valid applied record is not a failed migration");
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
  const subprocessEnv = { PATH: process.env.PATH ?? "", HOME: os.homedir(), NODE_ENV: "production" } as const;
  assert.ok(!("DATABASE_URL" in subprocessEnv), "readiness subprocess must not inherit a database connection string");
  for (const gate of ["code", "deploy"]) {
    const result = spawnSync(process.execPath, ["scripts/runtime/production-readiness.mjs", "--env", "process", "--gate", gate, "--json"], {
      cwd: process.cwd(),
      env: subprocessEnv,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout) as { ready: boolean; checks: Array<{ id: string; ok: boolean; detail: string }> };
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((check: { id: string }) => check.id === "config.env_source")?.id ?? null, "config.env_source");
    assert.equal(report.checks.find(check => check.id === "db.connect"), undefined);
    assert.equal(report.checks.find(check => check.id === "db.migrations"), undefined);
  }
  const source = readFileSync("scripts/runtime/production-readiness.mjs", "utf8");
  assert.match(source, /代码门禁\$\{blockingFailures\.length === 0 \? "通过" : "未通过"\}；未检查数据库状态/);
  assert.match(source, /部署清单与静态资产检查\$\{blockingFailures\.length === 0 \? "通过" : "未通过"\}；不代表部署包完整或生产已就绪/);
  assert.doesNotMatch(source, /数据侧已收口|部署包与内部资产完整/);
});

test("deployment gate rejects insecure auth, TLS overrides and unsafe write switches without DB IO", () => {
  const reportFor = (overrides: Record<string, string>) => {
    const result = spawnSync(process.execPath, ["scripts/runtime/production-readiness.mjs", "--env", "process", "--gate", "deploy", "--json"], {
      cwd: process.cwd(), encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", AUTH_PUBLIC_ORIGIN: "https://erp.example.com", AUTH_TRUSTED_PROXY: "caddy", AMAZON_FBA_REMOTE_EXECUTION_ENABLED: "false", AMAZON_ADS_EXECUTION_ENABLED: "false", ...overrides },
    });
    assert.equal(result.status, 1, "isolated incomplete configuration must remain blocked");
    const report = JSON.parse(result.stdout) as { checks: Array<{ id: string; ok: boolean }> };
    assert.equal(report.checks.some(row => row.id === "db.connect"), false);
    return (id: string) => { const check = report.checks.find(row => row.id === id); assert.ok(check, id); return check.ok; };
  };
  const valid = reportFor({});
  assert.equal(valid("config.auth_origin"), true);
  assert.equal(valid("config.tls_verification"), true);
  assert.equal(valid("gate.write_disabled"), true);
  assert.equal(reportFor({ AUTH_PUBLIC_ORIGIN: "http://erp.example.com" })("config.auth_origin"), false);
  assert.equal(reportFor({ AUTH_TRUSTED_PROXY: "" })("config.auth_origin"), false);
  assert.equal(reportFor({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })("config.tls_verification"), false);
  assert.equal(reportFor({ DATABASE_URL: "https://db.invalid" })("config.database_remote"), false);
  assert.equal(reportFor({ REDIS_URL: "postgresql://redis.invalid/app" })("config.redis_remote"), false);
  assert.equal(reportFor({ DATABASE_URL: "postgresql://isolated.invalid/app", REDIS_URL: "rediss://isolated.invalid" })("config.database_remote"), true);
  for (const value of ["", "FALSE", "flase", "true"]) {
    assert.equal(reportFor({ AMAZON_ADS_EXECUTION_ENABLED: value })("gate.write_disabled"), false);
    assert.equal(reportFor({ AMAZON_FBA_REMOTE_EXECUTION_ENABLED: value })("gate.write_disabled"), false);
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
