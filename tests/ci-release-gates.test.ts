import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parse } from "yaml";

type Workflow = { jobs: Record<string, { if?: string; needs?: string | string[]; steps: Array<{ name?: string; run?: string; env?: Record<string, string> }> }> };
const workflow = parse(readFileSync(new URL("../.github/workflows/ci-cd.yml", import.meta.url), "utf8")) as Workflow;

test("release CI enforces schema, strict types and UI guard before building an artifact", () => {
  const steps = workflow.jobs.build.steps;
  const build = steps.findIndex(step => step.name === "Build");
  for (const [name, command] of [["Validate Prisma schema", "npx --no-install prisma validate"], ["Typecheck", "npm run typecheck"], ["UI regression guard", "npm run ui:guard"]]) {
    const index = steps.findIndex(step => step.name === name);
    assert.ok(index >= 0 && index < build, `${name} must block the release build`);
    assert.equal(steps[index].run, command);
  }
  assert.ok(steps.findIndex(step => step.name === "Test") < build);
  assert.ok(steps.findIndex(step => step.name === "Lint") < build);
});

test("release script enforces worker heartbeat verification after deploy", () => {
  const release = readFileSync(new URL("../scripts/server-artifact-release.sh", import.meta.url), "utf8");
  // 部署后必须校验 worker 心跳，而不是只看 systemd is-active（假成功部署的根因）。
  assert.match(release, /assert_worker_heartbeats/);
  assert.match(release, /verify_worker_heartbeats/);
  assert.match(release, /rollback_application_release "worker_heartbeat"/);
  // 看门狗 timer 必须在发布时被安装并启用（运行时自愈兜底）。
  assert.match(release, /amazon-worker-watchdog\.timer/);
  assert.match(release, /enable --now amazon-worker-watchdog\.timer/);
});

test("worker watchdog unit, timer and script ship in the repo", () => {
  const root = resolve(new URL("..", import.meta.url).pathname);
  for (const file of [
    "scripts/runtime/worker-watchdog.mjs",
    "scripts/runtime/worker-watchdog-lib.mjs",
    "deploy/systemd/amazon-worker-watchdog.service",
    "deploy/systemd/amazon-worker-watchdog.timer",
  ]) {
    assert.ok(existsSync(resolve(root, file)), `missing ${file}`);
  }
  const service = readFileSync(resolve(root, "deploy/systemd/amazon-worker-watchdog.service"), "utf8");
  assert.match(service, /Type=oneshot/);
  assert.match(service, /User=root/); // 需要 systemctl restart 其他服务的权限
  const timer = readFileSync(resolve(root, "deploy/systemd/amazon-worker-watchdog.timer"), "utf8");
  assert.match(timer, /OnUnitActiveSec=/);
});

test("an existing production deployment cannot bypass the performance comparison job", () => {
  const perf = workflow.jobs["performance-regression"];
  assert.match(perf.if ?? "", /workflow_dispatch/);
  assert.match(perf.if ?? "", /inputs\.deploy_production/);
  assert.match(perf.if ?? "", /!inputs\.initial_deployment/);
  assert.equal(perf.steps.find(step => step.name === "Measure base revision")?.env?.BASE_SHA, "${{ github.event.pull_request.base.sha || inputs.base_sha }}");
  const deploy = workflow.jobs["deploy-production"];
  assert.ok(Array.isArray(deploy.needs) && deploy.needs.includes("build") && deploy.needs.includes("performance-regression"));
  assert.match(deploy.if ?? "", /needs\.performance-regression\.result == 'success'/);
  assert.match(deploy.if ?? "", /inputs\.initial_deployment && needs\.performance-regression\.result == 'skipped'/);
  assert.match(deploy.if ?? "", /needs\.build\.result == 'success'/);
});
