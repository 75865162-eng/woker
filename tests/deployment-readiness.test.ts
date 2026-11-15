import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { migrationReadiness, migrationCatalog, validConnection, authReadiness } from "../scripts/runtime/readiness-contract.mjs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const registry = JSON.parse(read("src/lib/runtime/worker-registry.json")) as Array<{ id: string; entry: string; service: string }>;

test("当前五项注册 Worker 均有真实入口、manager 命令和正式 systemd 合同", () => {
  assert.deepEqual(registry.map(worker => worker.id), ["import", "image-upscale", "amazon-sync", "sellfox-sync", "forecast"]);
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const worker of registry) {
    assert.ok(existsSync(new URL(`../${worker.entry}`, import.meta.url)));
    assert.equal(scripts[`worker:${worker.id}`], `node scripts/runtime/worker-manager.mjs ${worker.id}`);
    const unit = read(`deploy/systemd/${worker.service}.service`);
    assert.ok(unit.includes(`ExecStart=/usr/bin/npm run worker:${worker.id}`));
    assert.ok(unit.includes("Environment=ERP_RUNTIME_MODE=production"));
    assert.ok(unit.includes("EnvironmentFile=/opt/amazon-ad-bulk-operation/.env"));
    assert.ok(read("scripts/server-artifact-release.sh").includes(worker.service));
  }
  assert.ok(read("scripts/deployment-plan.mjs").includes("requiresForecastWorkerRestart: runtimeChanged"));
});

test("release-check 接受完整合成包，拒绝缺失注册 unit 和真实配置文件", () => {
  const root = mkdtempSync(fileURLToPath(new URL("../tmp/upgrade-release-contract-", import.meta.url)));
  const put = (file: string, content = "fixture") => { mkdirSync(path.dirname(path.join(root, "package", file)), { recursive: true }); writeFileSync(path.join(root, "package", file), content); };
  try {
    for (const dir of [".next-build/standalone/.next-build/static", ".next-build/standalone/public", "prisma/migrations"]) mkdirSync(path.join(root, "package", dir), { recursive: true });
    for (const file of [".next-build/standalone/server.js", "RELEASE-METADATA.json", "deployment-plan.json", "deploy/README.md", "deploy/production.env.example", "deploy/systemd/amazon-web.service"]) put(file);
    put("src/lib/runtime/worker-registry.json", JSON.stringify(registry));
    for (const worker of registry) { put(worker.entry); put(`deploy/systemd/${worker.service}.service`); }
    const check = () => {
      const artifact = "fixture.tar.gz";
      execFileSync("tar", ["-czf", artifact, "-C", "package", "."], { cwd: root });
      writeFileSync(path.join(root, "release-manifest.json"), JSON.stringify({ commit: "fixture", build: "passed", lint: "passed", tests: "passed", artifactSha256: createHash("sha256").update(readFileSync(path.join(root, artifact))).digest("hex") }));
      execFileSync("bash", [fileURLToPath(new URL("../scripts/release-check.sh", import.meta.url)), artifact], { cwd: root, env: { PATH: process.env.PATH, NODE_ENV: "test", SOURCE_COMMIT: "fixture" }, stdio: "pipe" });
    };
    check();
    rmSync(path.join(root, "package/deploy/systemd/amazon-forecast-worker.service"));
    assert.throws(check);
    put("deploy/systemd/amazon-forecast-worker.service");
    put("deploy/production.env");
    assert.throws(check);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("生产同机 loopback 合法，缺失、错误协议与占位符不合法", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]", "db.internal"]) {
    assert.equal(validConnection(`postgresql://user:pass@${host}:5432/erp`, ["postgresql:"]), true);
    assert.equal(validConnection(`redis://${host}:6379/0`, ["redis:"]), true);
  }
  for (const value of [undefined, "", "REPLACE:database", "https://db.invalid", "not-a-url"]) assert.equal(validConnection(value, ["postgresql:"]), false);
});

test("迁移校验拒绝缺失、漂移、失败、重复应用、未知记录和无步骤", () => {
  const catalog = [{ name: "one", checksum: "abc" }, { name: "two", checksum: "def" }];
  const history = catalog.map(row => ({ migration_name: row.name, checksum: row.checksum, finished_at: new Date(), rolled_back_at: null, applied_steps_count: 1 }));
  assert.equal(migrationReadiness(catalog, history).ok, true);
  for (const rows of [history.slice(1), [...history, history[0]], [...history, { ...history[0], migration_name: "unknown" }], history.map(row => ({ ...row, checksum: "drift" })), history.map(row => ({ ...row, finished_at: null })), history.map(row => ({ ...row, rolled_back_at: new Date() })), history.map(row => ({ ...row, applied_steps_count: 0 }))]) assert.equal(migrationReadiness(catalog, rows).ok, false);
  assert.equal(migrationReadiness([], []).ok, false);
  assert.ok(migrationCatalog(fileURLToPath(new URL("../prisma/migrations", import.meta.url))).length > 0);
});

test("认证公开来源要求生产公网 HTTPS 与 Caddy，隔离 loopback 不信任代理", () => {
  assert.equal(authReadiness({ NODE_ENV: "production", AUTH_PUBLIC_ORIGIN: "https://erp.example.com", AUTH_TRUSTED_PROXY: "caddy" }).ok, true);
  assert.equal(authReadiness({ NODE_ENV: "production", AUTH_PUBLIC_ORIGIN: "http://127.0.0.1:3017" }).ok, true);
  assert.equal(authReadiness({ NODE_ENV: "production", AUTH_PUBLIC_ORIGIN: "https://erp.example.com" }).ok, false);
  assert.equal(authReadiness({ NODE_ENV: "production", AUTH_PUBLIC_ORIGIN: "http://erp.example.com", AUTH_TRUSTED_PROXY: "caddy" }).ok, false);
});

test("生产模板保持未配置和写门禁关闭，发布校验覆盖模板与注册资产", () => {
  const env = parseEnv(read("deploy/production.env.example"));
  for (const key of ["DATABASE_URL", "REDIS_URL", "AMAZON_SP_API_LWA_CLIENT_ID", "AMAZON_ADS_LWA_CLIENT_SECRET", "AUTH_PUBLIC_ORIGIN"]) assert.match(env[key] ?? "", /^REPLACE:/);
  assert.equal(env.AUTH_TRUSTED_PROXY, "caddy");
  for (const key of ["AMAZON_FBA_REMOTE_EXECUTION_ENABLED", "AMAZON_ADS_EXECUTION_ENABLED"]) assert.equal(env[key], "false");
  assert.match(env.AUTH_SECRET ?? "", /^GENERATE:/);
  const release = read("scripts/release-check.sh");
  for (const asset of ["deploy/production.env.example", "deploy/README.md", "src/lib/runtime/worker-registry.json"]) assert.ok(release.includes(asset));
  assert.ok(release.includes("worker_path"));
});
