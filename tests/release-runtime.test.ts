import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Extract functions only: never execute a release or contact systemd.
const source = readFileSync(new URL("../scripts/server-artifact-release.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const functions = ["assert_service_release", "restart_runtime_service", "install_runtime_from_release"].map(name => {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}(?=\\n\\n)`, "m"));
  assert.ok(match, name); return match[0];
}).join("\n");

function run(stale: boolean, failRestart = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "release-runtime-"));
  try {
    writeFileSync(path.join(dir, "cwd"), "/old-release");
    return execFileSync("bash", ["-c", `${functions}
set -euo pipefail
fixture_dir="$1"
fixture_stale="$2"
fixture_fail="$3"
systemctl() {
  printf '%s\\n' "$*" >> "$fixture_dir/calls"
  case "$1" in
    restart) [ "$fixture_fail" != true ] || return 1; if [ "$fixture_stale" != true ]; then printf /new-release > "$fixture_dir/cwd"; fi ;;
    show) printf '123\\n' ;;
    is-active) return 0 ;;
  esac
}
readlink() { if [ "$2" = /proc/123/cwd ]; then cat "$fixture_dir/cwd"; else printf '%s\\n' "$2"; fi; }
sleep() { :; }
runtime_config=false
INITIAL_DEPLOYMENT=false
restart_web=false
restart_worker=false
restart_image_worker=false
restart_amazon_sync_worker=true
restart_sellfox_sync_worker=true
caddy_reload=false
install_runtime_from_release /new-release
cat "$fixture_dir/calls"
`, "release-runtime-test", dir, String(stale), String(failRestart)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("selected sync services really restart and verify the new process release", () => {
  const calls = run(false);
  for (const service of ["amazon-sync-worker", "amazon-sellfox-sync-worker"]) {
    assert.ok(calls.includes(`enable ${service}\n`));
    assert.ok(calls.includes(`restart ${service}\n`));
    assert.ok(calls.includes(`show ${service} --property=MainPID --value`));
  }
  assert.ok(!calls.includes("restart amazon-web"));
});

test("an active worker on an old release cannot pass deployment verification", () => {
  assert.throws(() => run(true), /Runtime release verification failed/);
});

test("a failed service restart cannot become a successful release", () => {
  assert.throws(() => run(false, true));
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
