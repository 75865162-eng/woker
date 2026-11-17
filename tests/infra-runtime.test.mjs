import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runMigration, migrationEnvironment } from "../deploy/systemd/run-migration.mjs";

const shellEnvironment = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT", "TEMP", "TMP"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const prepare = readFileSync(new URL("../deploy/systemd/prepare-runtime-user.sh", import.meta.url), "utf8");

function accountFixture(mode, options = {}) {
  const script = `${prepare.slice(0, prepare.indexOf('if [ "${BASH_SOURCE[0]}"'))}
id() { case "$*" in '-u') printf '0';; '-u amazon-erp') printf '%s' "$fixture_uid";; '-Gn amazon-erp') printf '%s' "$fixture_groups";; esac; }
getent() { [ "$fixture_missing" != true ] || return 2; printf 'amazon-erp:x:997:997::/var/lib/amazon-erp:/usr/sbin/nologin'; }
useradd() { printf '创建账号\\n'; fixture_missing=false; }
install() { printf '创建目录\\n'; }
runuser() { return 0; }
fixture_missing="$2"
fixture_uid="$3"
fixture_groups="$4"
prepare_runtime_user "$1"
`;
  return spawnSync("bash", ["-c", script, "infra-fixture", mode, String(options.missing ?? false), String(options.uid ?? 997), options.groups ?? "amazon-erp"], { env: shellEnvironment, encoding: "utf8", timeout: 10000 });
}

test("运行账号初始化仅显式初始化创建，发布缺账号/危险身份失败关闭", () => {
  const initial = accountFixture("--initialize", { missing: true });
  assert.equal(initial.status, 0, initial.stderr);
  assert.match(initial.stdout, /创建账号/);
  for (const options of [{ missing: true }, { uid: 0 }, { groups: "amazon-erp docker" }]) {
    const result = accountFixture("--prepare-release", options);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /创建账号/);
  }
  assert.equal(accountFixture("--unknown").status, 2);
});

test("迁移子进程必须使用同目标独立凭证，不回退不泄露凭证", () => {
  const base = { DATABASE_URL: "postgresql://runtime:runtime-secret@fixture.invalid:5432/fixture", MIGRATION_DATABASE_URL: "postgresql://owner:owner-secret@fixture.invalid:5432/fixture" };
  let calls = 0;
  const run = (command, args, options) => {
    calls++;
    assert.equal(command, "npm");
    assert.deepEqual(args, ["run", "db:migrate"]);
    assert.equal(options.env.DATABASE_URL, base.MIGRATION_DATABASE_URL);
    assert.equal(options.env.MIGRATION_DATABASE_URL, undefined);
    assert.equal(options.env.ERP_RUNTIME_MODE, "production");
    assert.equal(options.shell, false);
    return { status: 7 };
  };
  assert.equal(runMigration(base, run), 7);
  assert.equal(base.DATABASE_URL.includes("runtime-secret"), true);
  for (const value of [undefined, base.DATABASE_URL, "postgresql://owner:secret@other.invalid:5432/fixture", "postgresql://owner:secret@fixture.invalid:5432/other", "file:///fixture"]) {
    assert.equal(runMigration({ ...base, MIGRATION_DATABASE_URL: value }, run), 2);
  }
  assert.equal(calls, 1);
});

test("迁移两身份仅由指定根.env读取，继承进程变量不能覆盖或填补缺项", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "infra-migration-source-"));
  try {
    const file = path.join(directory, ".env");
    const runtime = "postgresql://app:fixture@fixture.invalid/fixture";
    const migration = "postgresql://owner:fixture@fixture.invalid/fixture";
    writeFileSync(file, `DATABASE_URL=${runtime}\nMIGRATION_DATABASE_URL=${migration}\n`);
    const mapped = migrationEnvironment(file, { DATABASE_URL: "inherited-runtime", MIGRATION_DATABASE_URL: "inherited-owner" });
    assert.equal(mapped.DATABASE_URL, runtime);
    assert.equal(mapped.MIGRATION_DATABASE_URL, migration);
    writeFileSync(file, `DATABASE_URL=${runtime}\n`);
    assert.equal(migrationEnvironment(file, { MIGRATION_DATABASE_URL: migration }).MIGRATION_DATABASE_URL, undefined);
    const release = readFileSync(new URL("../scripts/server-artifact-release.sh", import.meta.url), "utf8");
    assert.match(release, /node deploy\/systemd\/run-migration\.mjs "\$APP_DIR\/\.env"/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("全部注册应用unit非root、保留唯一环境源并移除管理凭证", () => {
  const registry = JSON.parse(readFileSync(new URL("../src/lib/runtime/worker-registry.json", import.meta.url), "utf8"));
  const names = ["amazon-web", ...registry.map(worker => worker.id === "import" ? "amazon-worker" : worker.id === "image-upscale" ? "amazon-image-upscale-worker" : worker.id === "amazon-sync" ? "amazon-sync-worker" : worker.id === "sellfox-sync" ? "amazon-sellfox-sync-worker" : "amazon-forecast-worker")];
  for (const name of names) {
    const unit = readFileSync(new URL(`../deploy/systemd/${name}.service`, import.meta.url), "utf8");
    for (const directive of ["User=amazon-erp", "Group=amazon-erp", "NoNewPrivileges=true", "CapabilityBoundingSet=", "UMask=0077", "UnsetEnvironment=MIGRATION_DATABASE_URL POSTGRES_PASSWORD", "EnvironmentFile=/opt/amazon-ad-bulk-operation/.env"]) assert.ok(unit.split(/\r?\n/).includes(directive), `${name}: ${directive}`);
    assert.doesNotMatch(unit, /User=root|\/etc\/tiaotiao/);
  }
});

test("本地存储相对路径、发布路径和不可写持久目录拒绝且不改已有数据权限", () => {
  const body = prepare.slice(prepare.indexOf('  driver="'), prepare.indexOf('  for directory'));
  for (const upload of ["uploads", "/fixture/releases/new/uploads", "/fixture/app/uploads", "/fixture/data"]) {
    const result = spawnSync("bash", ["-c", `set -euo pipefail
release=/fixture/releases/new
app=/fixture/app
fixture_upload="$1"
node() { case "$*" in *STORAGE_DRIVER*) printf local;; *) printf '%s' "$fixture_upload";; esac; }
realpath() { printf '%s' "$2"; }
install() { printf 'install\\n'; }
runuser() { return 1; }
check() {
${body}
}
check
`, "path-fixture", upload], { env: shellEnvironment, encoding: "utf8", timeout: 10000 });
    assert.notEqual(result.status, 0, upload);
    if (upload !== "/fixture/data") assert.doesNotMatch(result.stdout, /install/);
    assert.doesNotMatch(result.stdout, /chown/);
  }
});

test("精确可写目录仅为release tmp/cache，符号链接拒绝且不改代码或环境文件", () => {
  const body = prepare.slice(prepare.indexOf('  for directory'), prepare.indexOf('\n}\n'));
  const directory = mkdtempSync(path.join(tmpdir(), "infra-paths-"));
  try {
    const result = spawnSync("bash", ["-c", `set -euo pipefail
release="$1"
install() { printf '写目录:%s\\n' "$*"; }
runuser() { printf '只读检查:%s\\n' "$*"; }
check() {
${body}
}
check
`, "write-path-fixture", directory], { env: shellEnvironment, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const writes = result.stdout.split("\n").filter(line => line.startsWith("写目录:"));
    assert.equal(writes.length, 2);
    assert.ok(writes[0].endsWith("/tmp"));
    assert.ok(writes[1].endsWith("/.next-build/standalone/.next-build/cache"));
    assert.ok(writes.every(line => line.includes("-m 0700 -o amazon-erp -g amazon-erp")));
    assert.doesNotMatch(result.stdout, /chown|\.env|代码/);
    // 注入符号链接判定，验证拒绝分支，不依赖 Windows 创建链接权限。
    const rejected = spawnSync("bash", ["-c", `set -euo pipefail
release="$1"
[() { if test "$1" = ! && test "$2" = -L; then return 1; fi; builtin [ "$@"; }
install() { printf '不应写入'; }
check() {
${body}
}
check
`, "symlink-fixture", directory], { env: shellEnvironment, encoding: "utf8", timeout: 10000 });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /符号链接/);
    assert.doesNotMatch(rejected.stdout, /不应写入/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("准备脚本和发布入口通过 bash 语法检查，不执行主机操作", () => {
  for (const file of ["deploy/systemd/prepare-runtime-user.sh", "scripts/bootstrap-server.sh", "scripts/server-artifact-release.sh"]) execFileSync("bash", ["-n", file], { env: shellEnvironment });
});
