import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { inspectLiveConfiguration, inspectRuntimeConfiguration } from "../scripts/amazon-sync-live-preflight.mjs";
const valid = { DATABASE_URL: "postgresql://user:private-password@127.0.0.1:5555/local", REDIS_URL: "redis://:private-redis@127.0.0.1:6666/0", QUEUE_DRIVER: "redis", AMAZON_SP_API_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), AUTH_SECRET: "private-auth", AMAZON_SYNC_CENTER_SCOPES: '[["private-org","private-workspace"]]' };
test("live preflight prints no credentials or scope values and never connects", () => {
  const result = inspectLiveConfiguration(valid);
  assert.equal(result.configurationReady, true); assert.equal(result.connectedToServices, false); assert.equal(result.amazonRequests, 0);
  for (const secret of ["private-password", "private-redis", "private-auth", "private-org", "private-workspace", valid.AMAZON_SP_API_ENCRYPTION_KEY]) assert.ok(!JSON.stringify(result).includes(secret));
});
test("preflight uses only unified root configuration and rejects conflicts and alternate files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "erp-preflight-"));
  try {
    writeFileSync(path.join(root, ".env"), Object.entries(valid).map(([key, value]) => `${key}='${value}'`).join("\n"));
    writeFileSync(path.join(root, ".env.amazon-live.local"), "DATABASE_URL=private-alternate");
    assert.equal(inspectRuntimeConfiguration({ root, inherited: {} }).configurationReady, true);
    for (const inherited of [{ DOTENV_CONFIG_PATH: ".env.amazon-live.local" }, { AUTH_SECRET: "private-conflict" }, { ERP_LOCAL_INTEGRATION_PROFILE: "amazon-live-approved" }]) {
      const report = inspectRuntimeConfiguration({ root, inherited });
      assert.equal(report.configurationLoadFailed, true);
      assert.equal(report.configurationReady, false);
      assert.ok(!JSON.stringify(report).includes("private-"));
    }
    writeFileSync(path.join(root, ".env.local"), "AUTH_SECRET=private-extra");
    assert.equal(inspectRuntimeConfiguration({ root, inherited: {} }).configurationLoadFailed, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("production injection never falls back to root files and cannot pass local acceptance", () => {
  const report = inspectRuntimeConfiguration({ root: "/nonexistent-fixture-root", inherited: { ...valid, ERP_RUNTIME_MODE: "production" } });
  assert.equal(report.configurationReady, false);
  assert.equal(report.checks.notProductionMode, false);
  const child = spawnSync(process.execPath, ["scripts/amazon-sync-live-preflight.mjs"], {
    env: { PATH: process.env.PATH, ...valid, ERP_RUNTIME_MODE: "production" }, encoding: "utf8",
  });
  assert.equal(child.status, 2);
  assert.equal(JSON.parse(child.stdout).configurationReady, false);
  assert.equal(child.stderr, "");
  assert.ok(!child.stdout.includes("private-"));
});
test("live preflight fails closed for nonlocal services, invalid key, multiple scopes or production", () => {
  for (const override of [{ DATABASE_URL: "postgresql://host.example/db" }, { REDIS_URL: "redis://host.example" }, { AMAZON_SP_API_ENCRYPTION_KEY: "bad" }, { AMAZON_SYNC_CENTER_SCOPES: '[["org","ws"],["org","other"]]' }, { AMAZON_SYNC_CENTER_SCOPES: '[["org","*"]]' }, { NODE_ENV: "production" }, { QUEUE_DRIVER: "inline" }]) assert.equal(inspectLiveConfiguration({ ...valid, ...override }).configurationReady, false);
  assert.equal(inspectLiveConfiguration({}).configurationReady, false);
});
