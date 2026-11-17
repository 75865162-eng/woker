import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { migrationReadiness, migrationCatalog, validConnection, authReadiness } from "../scripts/runtime/readiness-contract.mjs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const registry = JSON.parse(read("src/lib/runtime/worker-registry.json")) as Array<{ id: string; entry: string; service: string }>;
const childProcessEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT", "TEMP", "TMP"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
  NODE_ENV: "test",
});

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
  let executionError: unknown;
  try {
    for (const dir of [".next-build/standalone/.next-build/static", ".next-build/standalone/public", "prisma/migrations"]) mkdirSync(path.join(root, "package", dir), { recursive: true });
    for (const file of [".next-build/standalone/server.js", ".next-build/standalone/.next-build/BUILD_ID", ".next-build/standalone/.next-build/server/app.js", ".next-build/standalone/.next-build/static/app.js", "prisma/migrations/fixture/migration.sql", "RELEASE-METADATA.json", "deployment-plan.json", "deploy/README.md", "deploy/production.env.example", "deploy/systemd/amazon-web.service"]) put(file);
    const metadata = { commit: "fixture", build: "passed", lint: "passed", tests: "passed" };
    put("RELEASE-METADATA.json", JSON.stringify(metadata));
    put("src/lib/runtime/worker-registry.json", JSON.stringify(registry));
    for (const worker of registry) { put(worker.entry); put(`deploy/systemd/${worker.service}.service`); }
    put("src/lib/uploads.ts");
    const check = () => {
      const artifact = "fixture.tar.gz";
      execFileSync("tar", ["-czf", artifact, "-C", "package", "."], { cwd: root, env: childProcessEnv(), timeout: 15_000 });
      writeFileSync(path.join(root, "release-manifest.json"), JSON.stringify({ commit: "fixture", build: "passed", lint: "passed", tests: "passed", artifactSha256: createHash("sha256").update(readFileSync(path.join(root, artifact))).digest("hex") }));
      execFileSync("bash", [fileURLToPath(new URL("../scripts/release-check.sh", import.meta.url)), artifact], { cwd: root, env: { ...childProcessEnv(), NODE_ENV: "test", SOURCE_COMMIT: "fixture" }, stdio: "pipe", timeout: process.platform === "win32" ? 120_000 : 30_000 });
    };
    assert.doesNotThrow(check);
    put("RELEASE-METADATA.json", JSON.stringify({ ...metadata, commit: "other" }));
    assert.throws(check, /Artifact metadata mismatch: commit/);
    put("RELEASE-METADATA.json", JSON.stringify(metadata));
    put(".next-build/standalone/server.js", "");
    assert.throws(check, /Empty required artifact file/);
    put(".next-build/standalone/server.js");
    rmSync(path.join(root, "package/deployment-plan.json"));
    put("decoy/deployment-plan.json");
    assert.throws(check, /Artifact is missing required path: deployment-plan.json/);
    put("deployment-plan.json");
    for (const name of ["production.env.bak", "production.env.old", "production.env.example.bak"]) {
      put(`deploy/${name}`);
      assert.throws(check, /Artifact contains a forbidden environment file/);
      rmSync(path.join(root, "package/deploy", name));
    }
    rmSync(path.join(root, "package/deploy/systemd/amazon-forecast-worker.service"));
    assert.throws(check, /Artifact is missing registered worker asset: deploy\/systemd\/amazon-forecast-worker\.service/);
    put("deploy/systemd/amazon-forecast-worker.service");
    put("deploy/production.env");
    assert.throws(check, /Artifact contains a forbidden environment file/);
    rmSync(path.join(root, "package/deploy/production.env"));
    mkdirSync(path.join(root, "package/uploads"), { recursive: true });
    put("uploads/root.txt");
    assert.throws(check, /Artifact contains forbidden path: uploads\//);
    rmSync(path.join(root, "package/uploads"), { recursive: true, force: true });
    mkdirSync(path.join(root, "package/src/nested/uploads"), { recursive: true });
    put("src/nested/uploads/data.txt");
    assert.throws(check, /Artifact contains forbidden path: uploads\//);
  } catch (error) {
    executionError = error;
    // Preserve the original child-process failure even if Windows still holds
    // an archive handle and the cleanup below throws as well.
    console.error("[release-check fixture] validation failed", error);
    throw error;
  } finally {
    try { rmSync(root, { recursive: true, force: true }); }
    catch (cleanupError) {
      console.error("[release-check fixture] cleanup failed", cleanupError);
      if (executionError !== undefined) throw new AggregateError([executionError, cleanupError], "发布校验与临时目录清理均失败", { cause: executionError });
      throw cleanupError;
    }
  }
});

test("部署入口在任何网络操作前拒绝失败、漂移或不完整的发布证据", () => {
  const root = mkdtempSync(fileURLToPath(new URL("../tmp/deploy-evidence-", import.meta.url)));
  const commit = "a".repeat(40);
  const artifact = path.join(root, "fixture.tar.gz");
  const report = path.join(root, "release-check.json");
  const script = fileURLToPath(new URL("../scripts/deploy-ci-artifact.sh", import.meta.url));
  writeFileSync(artifact, "isolated artifact fixture");
  const evidence = {
    status: "passed", commit, expectedCommit: commit,
    build: "passed", lint: "passed", tests: "passed",
    checks: { sha256: true, requiredPaths: true, forbiddenPaths: true },
    artifactSha256: createHash("sha256").update(readFileSync(artifact)).digest("hex"),
  };
  const run = (data: unknown, sourceCommit = commit) => {
    writeFileSync(report, typeof data === "string" ? data : JSON.stringify(data));
    return spawnSync("bash", ["-c", 'scp() { exit 93; }; ssh() { exit 94; }; source "$1" "$2"', "deploy-evidence-test", script, "fixture.tar.gz"], {
      cwd: root,
      env: { ...childProcessEnv(), NODE_ENV: "test", SOURCE_COMMIT: sourceCommit, SOURCE_BRANCH: "isolated-fixture", RELEASE_CHECK_PATH: "release-check.json", SERVER_HOST: "deployment-test.invalid", SERVER_USER: "fixture" },
      encoding: "utf8",
      timeout: 15_000,
    });
  };
  try {
    // A valid report must reach the first intercepted transfer. Neither function opens a connection.
    const accepted = run(evidence);
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 93, accepted.stderr);
    const invalidReports: unknown[] = ["{", { ...evidence, status: "failed" }, { ...evidence, commit: "b".repeat(40) }, { ...evidence, expectedCommit: "b".repeat(40) }, { ...evidence, artifactSha256: "0".repeat(64) }];
    for (const field of ["build", "lint", "tests"] as const) {
      for (const value of [undefined, "failed", "unknown", true]) invalidReports.push({ ...evidence, [field]: value });
    }
    for (const field of ["sha256", "requiredPaths", "forbiddenPaths"] as const) {
      for (const value of [undefined, false, "true"]) invalidReports.push({ ...evidence, checks: { ...evidence.checks, [field]: value } });
    }
    invalidReports.push({ ...evidence, checks: undefined });
    for (const data of invalidReports) {
      const rejected = run(data);
      assert.ifError(rejected.error);
      assert.equal(rejected.status, 1, `${JSON.stringify(data)}\n${rejected.stderr}`);
      assert.match(rejected.stderr, /Invalid release-check.json|does not validate this artifact and commit/);
    }
    const unknownCommit = run({ ...evidence, commit: "unknown", expectedCommit: "unknown" }, "unknown");
    assert.ifError(unknownCommit.error);
    assert.equal(unknownCommit.status, 1, unknownCommit.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("费用单主导航入口跳转到现有正式工作台", () => {
  assert.match(read("src/components/app-shell/business-navigation.ts"), /href: "\/operations\?view=expense-management", label: "ERP 费用单"/);
  assert.match(read("src/app/(erp)/operations/page.tsx"), /if \(view === "expense-management"\) redirect\("\/operations\/expenses"\)/);
  assert.match(read("src/app/(erp)/operations/expenses/page.tsx"), /<FinanceExpensesWorkbench/);
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
  const completeHistoryReadiness = migrationReadiness(catalog, history);
  assert.equal(completeHistoryReadiness.ok, true, completeHistoryReadiness.detail);
  for (const rows of [history.slice(1), [...history, history[0]], [...history, { ...history[0], migration_name: "unknown" }], history.map(row => ({ ...row, checksum: "drift" })), history.map(row => ({ ...row, finished_at: null })), history.map(row => ({ ...row, rolled_back_at: new Date() })), history.map(row => ({ ...row, applied_steps_count: 0 }))]) assert.equal(migrationReadiness(catalog, rows).ok, false);
  assert.equal(migrationReadiness(catalog, [{ ...history[0], finished_at: null, rolled_back_at: new Date(), checksum: "failed-attempt-sql" }, ...history]).ok, true);
  assert.equal(migrationReadiness(catalog, [{ ...history[0], finished_at: null, rolled_back_at: new Date(), checksum: "failed-attempt-sql" }, history[1]]).ok, false);
  for (const applied_steps_count of [undefined, null, "invalid", NaN, Infinity, 0.5, -1]) {
    assert.equal(migrationReadiness(catalog, [{ ...history[0], applied_steps_count }, history[1]]).ok, false);
  }
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
