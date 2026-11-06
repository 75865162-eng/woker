import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runtimeEnvironment } from "../scripts/runtime/environment.mjs";

test("database tools share root parsing and conflicts without requiring Redis", () => {
  const root = mkdtempSync(path.join(tmpdir(), "erp-database-tools-"));
  try {
    writeFileSync(path.join(root, ".env"), "DATABASE_URL=postgresql://fixture:password@127.0.0.1:5440/fixture\nAUTH_SECRET=literal$dollar\n");
    const options = { root, inherited: {}, validation: "database" as const };
    assert.equal(runtimeEnvironment(options).AUTH_SECRET, "literal$dollar");
    assert.throws(() => runtimeEnvironment({ ...options, inherited: { DATABASE_URL: "private-conflict" } }), /DATABASE_URL conflicts/);
    assert.throws(() => runtimeEnvironment({ ...options, inherited: { DOTENV_CONFIG_PATH: ".env.amazon-live.local" } }), /Alternate dotenv/);
    writeFileSync(path.join(root, ".env.local"), "IGNORED=no");
    assert.throws(() => runtimeEnvironment(options), /Extra Next environment/);
    rmSync(path.join(root, ".env.local"));
    writeFileSync(path.join(root, ".env"), "DATABASE_URL=postgresql://fixture@remote.invalid/fixture\n");
    assert.throws(() => runtimeEnvironment(options), /remote databases are forbidden/);
    assert.throws(() => runtimeEnvironment({ ...options, build: true }), /remote databases are forbidden/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("schema-only configuration can omit a database but validates supplied targets", () => {
  const root = mkdtempSync(path.join(tmpdir(), "erp-schema-tools-"));
  try {
    assert.equal(runtimeEnvironment({ root, inherited: {}, validation: "schema" }).DATABASE_URL, undefined);
    assert.throws(() => runtimeEnvironment({ root, inherited: {}, validation: "database" }), /Root .env is required/);
    assert.throws(() => runtimeEnvironment({ root, inherited: { DATABASE_URL: "postgresql://remote.invalid/fixture" }, validation: "schema" }), /remote databases are forbidden/);
    const env = runtimeEnvironment({ root, inherited: { ERP_RUNTIME_MODE: "production", DATABASE_URL: "postgresql://fixture@fixture.invalid/fixture" }, validation: "database" });
    assert.equal(env.REDIS_URL, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("database preload fails before script execution and never connects", () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ["--import", "./scripts/runtime/database-bootstrap.mjs", "-e", "console.log('fixture-script-executed')"], {
    env: { PATH: process.env.PATH, NODE_ENV: "test", ERP_RUNTIME_MODE: "production", ...env }, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(run({ DATABASE_URL: "postgresql://fixture@fixture.invalid/fixture" }).stdout.trim(), "fixture-script-executed");
  const missing = run({});
  assert.notEqual(missing.status, 0); assert.equal(missing.stdout, "");
  const alternate = run({ DOTENV_CONFIG_PATH: "private-fixture-alternate", DATABASE_URL: "postgresql://fixture@fixture.invalid/fixture" });
  assert.notEqual(alternate.status, 0); assert.equal(alternate.stdout, "");
  assert.ok(!alternate.stderr.includes("private-fixture-alternate"));
});

test("Prisma validates the actual schema without private configuration or a connection", () => {
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "validate"], {
    env: { PATH: process.env.PATH, NODE_ENV: "test", ERP_RUNTIME_MODE: "production" }, encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
