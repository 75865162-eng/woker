import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Extract functions only: never execute a release or contact systemd.
const source = readFileSync(new URL("../scripts/server-artifact-release.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const functions = ["assert_service_release", "restart_runtime_service", "install_runtime_from_release"].map(name => {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}(?=\\n\\n)`, "m"));
  assert.ok(match, name); return match[0];
}).join("\n");

const childProcessEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT", "TEMP", "TMP"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]])), NODE_ENV: "test" });

function run(stale: boolean, failRestart = false, allServices = false, failEnable = false, rootOverride = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "release-runtime-"));
  try {
    writeFileSync(path.join(dir, "cwd"), "/old-release");
    return execFileSync("bash", ["-c", `${functions}
set -euo pipefail
fixture_dir="$1"
fixture_stale="$2"
fixture_fail="$3"
fixture_all="$4"
fixture_enable_fail="$5"
fixture_root="$6"
systemctl() {
  printf '%s\\n' "$*" >> "$fixture_dir/calls"
  case "$1" in
    enable) [ "$fixture_enable_fail" != true ] || return 1 ;;
    restart) [ "$fixture_fail" != true ] || return 1; if [ "$fixture_stale" != true ]; then printf /new-release > "$fixture_dir/cwd"; fi ;;
    show) case "$*" in *--property=User*|*--property=Group*) if [ "$fixture_root" = true ]; then printf 'root\\n'; else printf 'amazon-erp\\n'; fi ;; *) printf '123\\n' ;; esac ;;
    is-active) return 0 ;;
  esac
}
readlink() { if [ "$2" = /proc/123/cwd ]; then cat "$fixture_dir/cwd"; else printf '%s\\n' "$2"; fi; }
sleep() { :; }
runtime_config=false
INITIAL_DEPLOYMENT=false
restart_web="$fixture_all"
restart_worker="$fixture_all"
restart_image_worker="$fixture_all"
restart_amazon_sync_worker=true
restart_sellfox_sync_worker=true
restart_forecast_worker=true
caddy_reload=false
install_runtime_from_release /new-release
cat "$fixture_dir/calls"
`, "release-runtime-test", dir, String(stale), String(failRestart), String(allServices), String(failEnable), String(rootOverride)], { encoding: "utf8", env: { ...childProcessEnv(), NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("selected sync services really restart and verify the new process release", () => {
  const calls = run(false);
  for (const service of ["amazon-sync-worker", "amazon-sellfox-sync-worker", "amazon-forecast-worker"]) {
    assert.ok(calls.includes(`enable ${service}\n`));
    assert.ok(calls.includes(`restart ${service}\n`));
    assert.ok(calls.includes(`show ${service} --property=MainPID --value`));
  }
  assert.ok(!calls.includes("restart amazon-web"));
});

test("every selected service is enabled before restart, including web/import/image", () => {
  const calls = run(false, false, true);
  for (const service of ["amazon-web", "amazon-worker", "amazon-image-upscale-worker", "amazon-sync-worker", "amazon-sellfox-sync-worker", "amazon-forecast-worker"]) {
    assert.ok(calls.indexOf(`enable ${service}\n`) >= 0);
    assert.ok(calls.indexOf(`enable ${service}\n`) < calls.indexOf(`restart ${service}\n`));
  }
});

test("root unit 或 drop-in 覆盖身份不能启动或伪装发布成功", () => {
  assert.throws(() => run(false, false, true, false, true), /拒绝启动非专用身份服务/);
});

test("a failed enable cannot become a successful release", () => {
  assert.throws(() => run(false, false, true, true));
});

test("an active worker on an old release cannot pass deployment verification", () => {
  assert.throws(() => run(true), /Runtime release verification failed/);
});

test("a failed service restart cannot become a successful release", () => {
  assert.throws(() => run(false, true));
});

test("rollback to a release without forecast stops the new service and completes runtime installation", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-rollback-"));
  try {
    const units = path.join(dir, "deploy/systemd");
    mkdirSync(units, { recursive: true });
    writeFileSync(path.join(units, "amazon-sync-worker.service"), "fixture");
    const calls = execFileSync("bash", ["-c", `${functions}
set -euo pipefail
systemctl() { printf '%s\\n' "$*"; }
install() { :; }
rm() { :; }
runtime_config=true
INITIAL_DEPLOYMENT=false
restart_web=false
restart_worker=false
restart_image_worker=false
restart_amazon_sync_worker=false
restart_sellfox_sync_worker=false
restart_forecast_worker=true
caddy_reload=false
install_runtime_from_release "$1"
printf 'forecast_restart=%s\\n' "$restart_forecast_worker"
`, "release-rollback-test", dir], { encoding: "utf8", env: { ...childProcessEnv(), NODE_ENV: "test" }, timeout: 15_000 });
    assert.ok(calls.includes("disable --now amazon-forecast-worker"));
    assert.ok(calls.includes("daemon-reload"));
    assert.ok(calls.includes("forecast_restart=false"));
    assert.ok(!calls.includes("restart amazon-forecast-worker"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("真实回滚函数明确记录历史root拒绝，非root旧版完成恢复", () => {
  const rollback = source.match(/^rollback_application_release\(\) \{[\s\S]*?^\}(?=\n\n)/m)?.[0];
  assert.ok(rollback);
  const dir = mkdtempSync(path.join(tmpdir(), "release-identity-rollback-"));
  try {
    for (const identity of ["root", "amazon-erp"]) {
      const output = execFileSync("bash", ["-c", `${functions}
${rollback}
set -euo pipefail
release_dir="$1"
previous_release_dir="$1"
RELEASE_RESULT_FILE="$1/result"
RELEASES_DIR="$1"
release_id=fixture
CURRENT_LINK=fixture-current
release_switched=true
INITIAL_DEPLOYMENT=false
runtime_config=false
restart_web=true
restart_worker=false
restart_image_worker=false
restart_amazon_sync_worker=false
restart_sellfox_sync_worker=false
restart_forecast_worker=false
caddy_reload=false
fixture_identity="$2"
restore_shared_config() { return 0; }
write_release_log() { printf '日志:%s\\n' "$*"; }
write_release_result() { printf '结果:%s\\n' "$*"; }
wait_for_health() { printf '健康检查\\n'; return 0; }
ln() { printf '恢复链接\\n'; }
readlink() { if [ "$2" = /proc/123/cwd ]; then printf '%s' "$previous_release_dir"; else printf '%s' "$2"; fi; }
systemctl() {
  case "$*" in
    *--property=User*|*--property=Group*) printf '%s' "$fixture_identity" ;;
    *--property=MainPID*) printf 123 ;;
    *) printf '服务:%s\\n' "$*" ;;
  esac
}
status=0
rollback_application_release health_check fixture_failure || status=$?
printf '回滚返回码:%s\\n' "$status"
`, "rollback-identity-test", dir, identity], { encoding: "utf8", env: childProcessEnv(), stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
      if (identity === "root") {
        assert.match(output, /日志:rollback_failed/);
        assert.match(output, /结果:.*failed health_check failed/);
        assert.doesNotMatch(output, /服务:restart|健康检查/);
      } else {
        assert.match(output, /日志:rolled_back/);
        assert.match(output, /结果:.*failed health_check succeeded/);
        assert.match(output, /服务:restart amazon-web/);
        assert.match(output, /健康检查/);
      }
      assert.match(output, /database not rolled back/);
      assert.match(output, /回滚返回码:1/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("release dependencies and generated clients are private copies, leaving legacy shared dependencies untouched", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-deps-"));
  try {
    const calls = execFileSync("bash", ["-c", `set -euo pipefail
root="$(cd "$1" && pwd)"
APP_DIR="$root/app"
extract_dir="$root/next"
previous_release_dir="$root/previous"
mkdir -p "$APP_DIR/node_modules/.prisma" "$extract_dir" "$previous_release_dir"
printf fixture > "$APP_DIR/.env"
printf old-client > "$APP_DIR/node_modules/.prisma/client"
printf lock > "$extract_dir/package-lock.json"
sha256sum "$extract_dir/package-lock.json" | awk '{print $1}' > "$APP_DIR/node_modules/.package-lock.sha256"
ln -s "$APP_DIR/node_modules" "$previous_release_dir/node_modules"
INITIAL_DEPLOYMENT=false
INSTALL_DEPS_ON_SERVER=false
infra_update=false
requires_migration=false
RUN_BOOTSTRAP_SEED=false
prepare_shared_config() { :; }
bash() { [ "$1" = "$extract_dir/deploy/systemd/prepare-runtime-user.sh" ]; [ "$2" = --prepare-release ]; }
npm() { [ "$PWD" = "$extract_dir" ]; [ "$*" = 'run db:generate' ]; printf new-client > node_modules/.prisma/client; }
${source.slice(source.indexOf('package_lock_checksum="'), source.indexOf('escaped_release_id="'))}
[ ! -L "$extract_dir/node_modules" ]
[ "$(cat "$APP_DIR/node_modules/.prisma/client")" = old-client ]
[ "$(cat "$extract_dir/node_modules/.prisma/client")" = new-client ]
printf isolated
`, "release-deps-test", dir], { encoding: "utf8", env: childProcessEnv(), timeout: 15_000 });
    assert.ok(calls.endsWith("isolated"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("shared compose and fixed Caddy mount configuration can be restored before switching releases", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-config-"));
  try {
    const configFunctions = ["prepare_shared_config", "restore_shared_config"].map(name => {
      const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}(?=\\n\\n)`, "m"));
      assert.ok(match); return match[0];
    }).join("\n");
    execFileSync("bash", ["-c", `set -euo pipefail
${configFunctions}
APP_DIR="$1/app"
extract_dir="$1/next"
shared_config_backup="$1/backup"
shared_config_prepared=false
infra_update=true
caddy_reload=true
INITIAL_DEPLOYMENT=false
mkdir -p "$APP_DIR/deploy/caddy" "$extract_dir/deploy/caddy"
printf old-compose > "$APP_DIR/docker-compose.yml"
printf old-caddy > "$APP_DIR/deploy/caddy/Caddyfile"
printf new-compose > "$extract_dir/docker-compose.yml"
printf new-caddy > "$extract_dir/deploy/caddy/Caddyfile"
prepare_shared_config
[ "$(cat "$APP_DIR/deploy/caddy/Caddyfile")" = new-caddy ]
restore_shared_config
[ "$(cat "$APP_DIR/docker-compose.yml")" = old-compose ]
[ "$(cat "$APP_DIR/deploy/caddy/Caddyfile")" = old-caddy ]
`, "release-config-test", dir], { encoding: "utf8", env: childProcessEnv(), timeout: 15_000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("version state is committed only after HTTP and runtime verification", () => {
  assert.ok(source.indexOf('cat > "${VERSION_STATE_FILE}.tmp"') > source.indexOf('if [ "$runtime_status" != "passed" ]'));
  assert.ok(!source.includes('cp "$extract_dir/package.json" "$APP_DIR/package.json"'));
  assert.ok(!source.includes('ln -sfn "$APP_DIR/node_modules"'));
  assert.ok(source.indexOf("if ! restore_shared_config") < source.indexOf('if [ "$release_switched" != "true" ]'));
});

test("SP-API service boots from persistent server configuration and survives delayed dependencies", () => {
  const unit = readFileSync(new URL("../deploy/systemd/amazon-sync-worker.service", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const section = (name: string) => unit.split(`[${name}]`)[1]?.split(/\n\[/)[0] ?? "";
  assert.match(section("Unit"), /^StartLimitIntervalSec=0$/m, "dependency outages must not exhaust the systemd startup limit");
  for (const directive of [
    "WorkingDirectory=/opt/amazon-ad-bulk-current",
    "EnvironmentFile=/opt/amazon-ad-bulk-operation/.env",
    "Environment=AMAZON_SYNC_WORKER_CONCURRENCY=1",
    "ExecStart=/usr/bin/npm run worker:amazon-sync",
    "Restart=always", "RestartSec=5",
  ]) assert.ok(section("Service").split("\n").includes(directive), directive);
  assert.match(section("Install"), /^WantedBy=multi-user.target$/m);
  assert.ok(!unit.includes(".env.amazon-live.local"));
});
